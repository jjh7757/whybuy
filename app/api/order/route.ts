import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, getBuyableCash, placeBuyOrder } from "@/lib/kis";
import { isMarketOpen, isValidTickPrice } from "@/lib/market";
import { REASON_TYPES } from "@/lib/rationale";
import { logEvent } from "@/lib/events";
import { DEFAULT_ALLOCATED_AMOUNT, getMyPortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

const REASON_VALUES = new Set<string>(REASON_TYPES.map((r) => r.value));

type Body = {
  stockCode?: string;
  qty?: number;
  reasonType?: string;
  reasonMemo?: string;
  orderType?: "market" | "limit";
  limitPrice?: number;
};

/**
 * 흐름 D 9~17단계. 매수 주문을 접수합니다.
 *
 * 🔴 검증 순서가 기획서 순서입니다: 로그인 → 장 시간 → 중복 → 가상 예산 →
 * 실제 예수금 → KIS 접수. 가상 예산을 실제 예수금보다 먼저 보는 이유는,
 * 가상 예산이 "사용자 1명이 계좌를 몰아 쓰는 것"을 막는 1차 방어선이고
 * 실제 예수금 확인은 계좌 전체를 지키는 최종 방어선이기 때문입니다.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_input", message: "잘못된 요청입니다." },
      { status: 400 },
    );
  }

  const stockCode = body.stockCode;
  const qty = Number(body.qty);
  const reasonType = body.reasonType;
  const reasonMemo = body.reasonMemo?.trim() || null;
  const orderType = body.orderType === "limit" ? "limit" : "market";
  const limitPrice = orderType === "limit" ? Number(body.limitPrice) : null;

  // 예외 2.9는 클라이언트가 버튼을 비활성화해 막지만, 서버도 독립적으로 검증합니다.
  if (
    !stockCode ||
    !/^[0-9A-Z]{6}$/.test(stockCode) ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    !reasonType ||
    !REASON_VALUES.has(reasonType) ||
    (orderType === "limit" &&
      (!Number.isInteger(limitPrice) || !isValidTickPrice(limitPrice as number)))
  ) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", message: "입력값이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  // 예외 2.10 — 로그인하지 않은 사용자
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  // 예외 2.4 — 장 운영시간이 아님. 조회는 계속 가능해야 하므로 이 라우트만 차단합니다.
  if (!isMarketOpen()) {
    await logEvent("order_rejected_market_closed", "operation", { stock_code: stockCode });
    return NextResponse.json({
      ok: false,
      code: "market_closed",
      message:
        "지금은 장 운영시간이 아닙니다. 평일 09:00~15:30에 주문할 수 있습니다. 계좌 확인과 종목 조회는 지금도 가능합니다.",
    });
  }

  const { data: stock } = await supabase
    .from("stocks")
    .select("stock_name, is_active")
    .eq("stock_code", stockCode)
    .maybeSingle();
  if (!stock || !stock.is_active) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", message: "지원하지 않는 종목입니다." },
      { status: 400 },
    );
  }

  // 예외 2.6 — 중복 주문(60초 내 동일 종목·동일 수량)
  const { data: recent } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", user.id)
    .eq("stock_code", stockCode)
    .eq("qty", qty)
    .gt("created_at", new Date(Date.now() - 60_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recent) {
    await logEvent("duplicate_order_blocked", "operation", {
      user_id: user.id,
      stock_code: stockCode,
      qty,
    });
    return NextResponse.json({
      ok: false,
      code: "duplicate",
      message: "방금 같은 주문을 넣었습니다. 회고 화면에서 확인해보세요.",
    });
  }

  // 지정가는 사용자가 이미 가격을 정했으니 시세를 다시 물어볼 필요가 없습니다
  // (KIS 레이트리밋 예산도 아낍니다). 시장가만 현재가를 조회합니다.
  let price: number;
  if (orderType === "limit") {
    price = limitPrice as number;
  } else {
    try {
      price = (await getQuote(stockCode)).price;
    } catch (err) {
      console.error("[/api/order] 시세 조회 실패", err);
      return NextResponse.json(
        { ok: false, code: "quote_failed", message: "시세를 확인하지 못해 주문할 수 없습니다." },
        { status: 502 },
      );
    }
  }
  const expectedAmount = price * qty;

  // 지갑 생성은 admin 클라이언트로만 합니다. user_wallets에는 insert 정책이 없어
  // 세션 클라이언트로는 애초에 쓸 수 없습니다(브라우저가 자기 예산을 조작하는 것을 막기 위함).
  const admin = createAdminClient();
  await admin
    .from("user_wallets")
    .upsert(
      { user_id: user.id, allocated_amount: DEFAULT_ALLOCATED_AMOUNT },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  // 대기중인 지정가 주문도 예산을 묶어두므로, 단순 합산이 아니라 getMyPortfolio의
  // 규칙(lib/portfolio.ts)을 그대로 재사용해 일관성을 맞춥니다.
  const { remaining } = await getMyPortfolio(supabase, user.id);

  // 예외 2.11 — 가상 예산 초과 (실제 예수금과 무관한 사용자별 1차 방어선)
  if (expectedAmount > remaining) {
    await logEvent("order_rejected_budget_exceeded", "operation", {
      user_id: user.id,
      requested_amount: expectedAmount,
      remaining,
    });
    return NextResponse.json({
      ok: false,
      code: "budget_exceeded",
      message: `가상 예산을 초과했습니다. 남은 한도 ${remaining.toLocaleString("ko-KR")}원. 수량을 줄여보세요.`,
      remaining,
    });
  }

  // 예외 2.5 — 실제 계좌 예수금 부족 (계좌 전체를 지키는 최종 방어선)
  let buyableCash: number;
  try {
    buyableCash = await getBuyableCash(stockCode);
  } catch (err) {
    console.error("[/api/order] 매수가능조회 실패", err);
    return NextResponse.json(
      { ok: false, code: "quote_failed", message: "계좌 상태를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
  if (expectedAmount > buyableCash) {
    await logEvent("order_rejected_insufficient_funds", "operation", {
      user_id: user.id,
      stock_code: stockCode,
      requested_amount: expectedAmount,
      buyable_cash: buyableCash,
    });
    return NextResponse.json({
      ok: false,
      code: "insufficient_funds",
      message: `예수금이 부족합니다. 현재 ${buyableCash.toLocaleString("ko-KR")}원, 필요 ${expectedAmount.toLocaleString("ko-KR")}원. 수량을 줄여보세요.`,
    });
  }

  // 여기까지 통과하면 주문을 만듭니다. RLS의 "orders insert own"이
  // auth.uid() = user_id를 요구하므로 세션 클라이언트로 그대로 씁니다.
  const { data: orderRow, error: insertErr } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      stock_code: stockCode,
      stock_name: stock.stock_name,
      qty,
      expected_price: price,
      expected_amount: expectedAmount,
      status: "requested",
      order_type: orderType,
      limit_price: limitPrice,
    })
    .select("id")
    .single();

  if (insertErr || !orderRow) {
    console.error("[/api/order] 주문 행 생성 실패", insertErr);
    return NextResponse.json(
      { ok: false, code: "server_error", message: "주문을 저장하지 못했습니다." },
      { status: 502 },
    );
  }

  // 🔴 KIS 호출보다 먼저 저장합니다. KIS가 실패해도 사용자가 근거를 만든
  // 사실은 유효하므로, 실패 이후에 저장하면 그 사실이 사라집니다.
  await supabase
    .from("rationales")
    .insert({ order_id: orderRow.id, reason_type: reasonType, reason_memo: reasonMemo });
  await logEvent("rationale_recorded", "domain", {
    reason_type: reasonType,
    has_memo: reasonMemo !== null,
  });

  try {
    const { orderNo, krxFwdgOrdOrgno } = await placeBuyOrder(
      stockCode,
      qty,
      orderType === "limit" ? (limitPrice as number) : undefined,
    );

    // 시장가는 접수 즉시 체결로 취급합니다(지금까지 해온 방식 그대로, 이름만
    // status='filled'로 바뀜). 지정가는 실제로 체결됐는지 KIS에 다시 물어봐야
    // 알 수 있으니 대기중(submitted)으로 남겨두고, 사용자가 "체결 확인"을 누르면
    // /api/order/[id]/check-fill이 채웁니다.
    const isMarket = orderType === "market";
    await supabase
      .from("orders")
      .update({
        status: isMarket ? "filled" : "submitted",
        order_no: orderNo,
        krx_fwdg_ord_orgno: krxFwdgOrdOrgno,
        filled_qty: isMarket ? qty : 0,
        filled_price: isMarket ? price : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderRow.id);

    await logEvent("order_submitted", "domain", {
      stock_code: stockCode,
      qty,
      expected_price: price,
      order_no: orderNo,
      order_type: orderType,
    });

    return NextResponse.json({
      ok: true,
      orderId: orderRow.id,
      orderNo,
      status: isMarket ? "filled" : "submitted",
    });
  } catch (err) {
    // 예외 2.8 — KIS가 주문을 거부함
    const reason = err instanceof Error ? err.message : String(err);

    await supabase
      .from("orders")
      .update({
        status: "rejected",
        reject_reason: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderRow.id);

    await logEvent("order_rejected", "domain", { stock_code: stockCode, qty, reason });

    return NextResponse.json({
      ok: false,
      code: "kis_rejected",
      message: `주문이 거부되었습니다. 사유: ${reason}`,
    });
  }
}
