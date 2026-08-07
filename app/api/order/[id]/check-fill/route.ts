import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkOrderFill } from "@/lib/kis";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * 지정가 주문 하나의 체결 상태를 KIS에 다시 물어봅니다.
 *
 * 🔴 자동 폴링(스케줄러)은 기획서 Won't Have라서 만들지 않았습니다 — 사용자가
 * "내 계좌"에서 이 버튼을 직접 눌렀을 때만 KIS를 부릅니다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ ok: false, message: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  // RLS의 "select own orders"가 본인 행만 돌려주므로 소유권은 자연히 걸러집니다.
  const { data: order } = await supabase
    .from("orders")
    .select("id, qty, order_no, status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || !order.order_no) {
    return NextResponse.json({ ok: false, message: "주문을 찾을 수 없습니다." }, { status: 404 });
  }
  if (order.status !== "submitted") {
    return NextResponse.json(
      { ok: false, message: "대기중인 주문이 아닙니다." },
      { status: 400 },
    );
  }

  let fill;
  try {
    fill = await checkOrderFill(order.order_no);
  } catch (err) {
    console.error("[/api/order/[id]/check-fill]", err);
    return NextResponse.json(
      { ok: false, message: "체결 여부를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
  if (!fill) {
    return NextResponse.json({ ok: false, message: "체결 여부를 확인하지 못했습니다." }, { status: 502 });
  }

  const nowFilled = fill.filledQty >= order.qty;
  await supabase
    .from("orders")
    .update({
      status: nowFilled ? "filled" : "submitted",
      filled_qty: fill.filledQty,
      filled_price: fill.filledQty > 0 ? fill.avgFillPrice : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  await logEvent("order_fill_checked", "operation", {
    order_id: orderId,
    filled_qty: fill.filledQty,
    remaining_qty: fill.remainingQty,
  });

  return NextResponse.json({
    ok: true,
    filledQty: fill.filledQty,
    remainingQty: fill.remainingQty,
    status: nowFilled ? "filled" : "submitted",
  });
}
