import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/kis";
import { createClient } from "@/lib/supabase/server";
import { getMyPortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * 로그인 사용자가 이 서비스로 주문한 종목과 남은 가상 예산을 반환합니다.
 *
 * 공용 KIS 모의계좌의 잔고 전체를 보여주지 않습니다. 그 계좌에는 다른 방문자의
 * 주문과 서비스 이전부터 있던 종목이 섞여 있어, 로그인 사용자의 것이 아닙니다.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ loggedIn: false });
  }

  let portfolio;
  try {
    portfolio = await getMyPortfolio(supabase, user.id);
  } catch (err) {
    console.error("[/api/account] 포트폴리오 조회 실패", err);
    return NextResponse.json(
      { error: "계좌 정보를 불러오지 못했습니다." },
      { status: 502 },
    );
  }

  // 🔴 시세 조회가 실패해도 보유 목록과 예산은 그대로 응답합니다.
  // 현재가는 부가 정보이고, 실패하면 화면에서 `—`로 나갑니다.
  let prices: Record<string, number | null> = {};
  if (portfolio.holdings.length > 0) {
    try {
      ({ prices } = await getQuotes(portfolio.holdings.map((h) => h.stockCode)));
    } catch (err) {
      console.error("[/api/account] 시세 조회 실패", err);
    }
  }

  const holdings = portfolio.holdings.map((h) => {
    const price = prices[h.stockCode] ?? null;
    const evalAmount = price === null ? null : price * h.qty;
    return {
      ...h,
      avgOrderPrice: Math.round(h.avgOrderPrice),
      currentPrice: price,
      evalAmount,
      profitLoss: evalAmount === null ? null : evalAmount - h.orderedAmount,
      profitLossRate:
        evalAmount === null
          ? null
          : ((evalAmount - h.orderedAmount) / h.orderedAmount) * 100,
    };
  });

  const valued = holdings.filter((h) => h.evalAmount !== null);
  const totalEvaluation = valued.length
    ? valued.reduce((s, h) => s + (h.evalAmount ?? 0), 0)
    : null;
  const totalProfitLoss = valued.length
    ? valued.reduce((s, h) => s + (h.profitLoss ?? 0), 0)
    : null;

  return NextResponse.json({
    loggedIn: true,
    allocated: portfolio.allocated,
    spent: portfolio.spent,
    remaining: portfolio.remaining,
    holdings,
    totalEvaluation,
    totalProfitLoss,
    // 일부 종목의 시세를 못 받았는지 화면이 알 수 있게 합니다.
    partialPrices: valued.length !== holdings.length,
  });
}
