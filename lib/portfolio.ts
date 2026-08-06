import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 로그인 사용자에게 기본 지급되는 가상 예산입니다. */
export const DEFAULT_ALLOCATED_AMOUNT = 5_000_000;

export type Holding = {
  stockCode: string;
  stockName: string;
  qty: number;
  /**
   * 주문 당시 가격의 가중평균입니다. 실제 체결가가 아닙니다.
   *
   * 시장가 주문이라 체결가는 주문 시점에 알 수 없고, 체결 조회는 범위 밖(Won't)입니다.
   * "내가 얼마를 보고 샀는가"를 남기는 것이 이 서비스의 목적이므로 주문가를 씁니다.
   */
  avgOrderPrice: number;
  /** 주문 금액 합계 (가상 예산에서 차감된 금액) */
  orderedAmount: number;
};

export type Portfolio = {
  allocated: number;
  spent: number;
  remaining: number;
  holdings: Holding[];
};

type OrderRow = {
  stock_code: string;
  stock_name: string;
  qty: number;
  expected_price: number;
  expected_amount: number;
};

/**
 * 로그인 사용자가 **이 서비스를 통해 주문한 것만** 모아 보여줍니다.
 *
 * 🔴 KIS 계좌 잔고를 쓰지 않는 이유:
 * 모의계좌 1개를 여러 방문자가 나눠 쓰므로, 계좌 잔고에는 다른 사람의 주문과
 * 서비스 이전부터 있던 보유 종목이 섞여 있습니다. 그것을 "내 계좌"로 보여주면
 * 로그인 사용자가 사지도 않은 종목을 자기 것으로 읽게 됩니다.
 *
 * 매도는 범위 밖(Won't)이므로 매수 주문 합계가 곧 보유 수량입니다.
 */
export async function getMyPortfolio(
  supabase: SupabaseClient,
  userId: string,
): Promise<Portfolio> {
  // RLS의 "select own orders"가 본인 행만 돌려주지만,
  // 이 함수는 user_id를 인자로 받으므로 의도를 코드에도 남겨 둡니다.
  const { data, error } = await supabase
    .from("orders")
    .select("stock_code, stock_name, qty, expected_price, expected_amount")
    .eq("user_id", userId)
    .eq("status", "submitted");

  if (error) throw error;

  const rows = (data ?? []) as OrderRow[];

  const byCode = new Map<string, Holding>();
  let spent = 0;

  for (const r of rows) {
    spent += r.expected_amount;

    const existing = byCode.get(r.stock_code);
    if (existing) {
      const totalQty = existing.qty + r.qty;
      const totalAmount = existing.orderedAmount + r.expected_amount;
      existing.qty = totalQty;
      existing.orderedAmount = totalAmount;
      existing.avgOrderPrice = totalAmount / totalQty;
    } else {
      byCode.set(r.stock_code, {
        stockCode: r.stock_code,
        stockName: r.stock_name,
        qty: r.qty,
        avgOrderPrice: r.expected_amount / r.qty,
        orderedAmount: r.expected_amount,
      });
    }
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
    holdings: [...byCode.values()].sort((a, b) => b.orderedAmount - a.orderedAmount),
  };
}
