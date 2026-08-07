import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyPortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * 남은 가상 예산만 돌려줍니다. KIS를 부르지 않습니다.
 *
 * 🔴 `/api/account`와 나눈 이유: 주문 화면은 "얼마까지 살 수 있는가"만 필요한데,
 * `/api/account`는 보유 종목의 현재가까지 KIS로 조회합니다. 예산 한 줄 때문에
 * 종목 수만큼 KIS를 부르면 시세·차트 호출과 겹쳐 한도(EGW00201)에 걸립니다.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ loggedIn: false });
  }

  try {
    const p = await getMyPortfolio(supabase, user.id);
    return NextResponse.json({
      loggedIn: true,
      allocated: p.allocated,
      spent: p.spent,
      remaining: p.remaining,
      // 매도 폼의 수량 상한용입니다. getMyPortfolio는 KIS를 부르지 않으므로
      // (Supabase 조회뿐) 여기서 같이 내려줘도 이 라우트의 존재 이유가 깨지지 않습니다.
      availableToSell: p.availableToSell,
    });
  } catch (err) {
    console.error("[/api/budget]", err);
    return NextResponse.json(
      { error: "예산을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
