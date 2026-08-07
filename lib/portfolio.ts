import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 로그인 사용자에게 기본 지급되는 가상 예산입니다. */
export const DEFAULT_ALLOCATED_AMOUNT = 5_000_000;

export type Holding = {
  stockCode: string;
  stockName: string;
  qty: number;
  /** 체결된 매수 수량의 가중평균 체결가입니다(매도해도 바뀌지 않는 평단가). */
  avgOrderPrice: number;
  /** 남은 보유 수량 기준 금액(qty * avgOrderPrice) */
  orderedAmount: number;
};

/** 아직 다 체결되지 않은 지정가 주문 — 취소·체결확인 버튼의 대상입니다. */
export type PendingOrder = {
  id: number;
  orderNo: string;
  krxFwdgOrdOrgno: string;
  stockCode: string;
  stockName: string;
  side: "buy" | "sell";
  qty: number;
  filledQty: number;
  limitPrice: number;
  createdAt: string;
};

export type Portfolio = {
  allocated: number;
  spent: number;
  remaining: number;
  holdings: Holding[];
  pendingOrders: PendingOrder[];
  /** 종목코드별로 지금 매도 주문을 넣을 수 있는 최대 수량(대기중인 매도 잔량은 이미 뺀 값). */
  availableToSell: Record<string, number>;
};

type OrderRow = {
  id: number;
  stock_code: string;
  stock_name: string;
  side: string;
  qty: number;
  expected_price: number;
  status: string;
  order_type: string;
  limit_price: number | null;
  filled_qty: number;
  filled_price: number | null;
  order_no: string | null;
  krx_fwdg_ord_orgno: string | null;
  created_at: string;
};

/**
 * 한 주문이 가상 예산에서 묶고 있는(또는 돌려주는) 금액입니다.
 *
 * 매수: 체결된 수량은 `filled_price`로, 아직 체결 안 된 잔량(지정가 대기중)은
 * `limit_price`로 계산해 묶어둡니다. 대기중인 지정가 주문도 실제 증권사처럼 매수
 * 여력을 미리 묶어둬야, 취소하지 않은 채 다른 종목을 또 사는 걸 막을 수 있습니다.
 *
 * 🔴 매도: 체결된 만큼만 예산으로 돌려줍니다(음수 lock). 대기중인 지정가 매도는
 * 아직 현금이 들어온 게 아니므로 예산에 영향을 주지 않습니다 — 대신 그 수량은
 * `availableToSell` 쪽에서 "이미 팔려고 내놓은 물량"으로 빼서 중복 매도를 막습니다.
 */
function lockedAmount(o: OrderRow): number {
  const filledPortion = o.filled_qty * (o.filled_price ?? 0);
  if (o.side === "sell") return -filledPortion;
  if (o.status !== "submitted") return filledPortion;
  const remainingQty = o.qty - o.filled_qty;
  const remainingPrice = o.limit_price ?? o.expected_price;
  return filledPortion + remainingQty * remainingPrice;
}

/**
 * 로그인 사용자가 **이 서비스를 통해 주문한 것만** 모아 보여줍니다.
 *
 * 🔴 KIS 계좌 잔고를 쓰지 않는 이유:
 * 모의계좌 1개를 여러 방문자가 나눠 쓰므로, 계좌 잔고에는 다른 사람의 주문과
 * 서비스 이전부터 있던 보유 종목이 섞여 있습니다. 그것을 "내 계좌"로 보여주면
 * 로그인 사용자가 사지도 않은 종목을 자기 것으로 읽게 됩니다.
 *
 * 지정가 주문은 접수해도 안 체결될 수 있어(시장가와 다름), `filled_qty`가
 * 실제로 늘어난 만큼만 보유로 칩니다 — 부분체결도 그만큼은 이미 내 것입니다.
 *
 * 🔴 평단가(avgOrderPrice)는 매수 체결분만으로 계산하고 매도해도 바꾸지 않습니다
 * (평균 매입단가 방식) — 일부를 팔았다고 남은 주식의 원가가 바뀌는 게 아닙니다.
 */
export async function getMyPortfolio(
  supabase: SupabaseClient,
  userId: string,
): Promise<Portfolio> {
  // RLS의 "select own orders"가 본인 행만 돌려주지만,
  // 이 함수는 user_id를 인자로 받으므로 의도를 코드에도 남겨 둡니다.
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, stock_code, stock_name, side, qty, expected_price, status, order_type, limit_price, filled_qty, filled_price, order_no, krx_fwdg_ord_orgno, created_at",
    )
    .eq("user_id", userId);

  if (error) throw error;

  const rows = (data ?? []) as OrderRow[];

  type Accum = { stockName: string; buyQty: number; buyAmount: number; sellQty: number };
  const byCode = new Map<string, Accum>();
  let spent = 0;
  const pendingOrders: PendingOrder[] = [];
  const pendingSellQty = new Map<string, number>();

  for (const r of rows) {
    spent += lockedAmount(r);

    if (r.filled_qty > 0) {
      const acc = byCode.get(r.stock_code) ?? {
        stockName: r.stock_name,
        buyQty: 0,
        buyAmount: 0,
        sellQty: 0,
      };
      if (r.side === "sell") {
        acc.sellQty += r.filled_qty;
      } else {
        acc.buyQty += r.filled_qty;
        acc.buyAmount += r.filled_qty * (r.filled_price ?? 0);
      }
      byCode.set(r.stock_code, acc);
    }

    const remainingQty = r.qty - r.filled_qty;
    if (r.status === "submitted" && remainingQty > 0 && r.order_no && r.krx_fwdg_ord_orgno) {
      pendingOrders.push({
        id: r.id,
        orderNo: r.order_no,
        krxFwdgOrdOrgno: r.krx_fwdg_ord_orgno,
        stockCode: r.stock_code,
        stockName: r.stock_name,
        side: r.side === "sell" ? "sell" : "buy",
        qty: r.qty,
        filledQty: r.filled_qty,
        limitPrice: r.limit_price ?? r.expected_price,
        createdAt: r.created_at,
      });
      if (r.side === "sell") {
        pendingSellQty.set(r.stock_code, (pendingSellQty.get(r.stock_code) ?? 0) + remainingQty);
      }
    }
  }

  const holdings: Holding[] = [];
  const availableToSell: Record<string, number> = {};
  for (const [stockCode, acc] of byCode) {
    const netQty = acc.buyQty - acc.sellQty;
    if (netQty > 0) {
      holdings.push({
        stockCode,
        stockName: acc.stockName,
        qty: netQty,
        avgOrderPrice: acc.buyAmount / acc.buyQty,
        orderedAmount: netQty * (acc.buyAmount / acc.buyQty),
      });
    }
    availableToSell[stockCode] = Math.max(0, netQty - (pendingSellQty.get(stockCode) ?? 0));
  }

  const { data: wallet } = await supabase
    .from("user_wallets")
    .select("allocated_amount")
    .eq("user_id", userId)
    .maybeSingle();

  // 지갑 행은 첫 주문 시 생깁니다. 아직 없으면 기본 예산을 그대로 보여줍니다.
  const allocated = wallet?.allocated_amount ?? DEFAULT_ALLOCATED_AMOUNT;

  return {
    allocated,
    spent,
    remaining: allocated - spent,
    holdings: holdings.sort((a, b) => b.orderedAmount - a.orderedAmount),
    pendingOrders: pendingOrders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    availableToSell,
  };
}
