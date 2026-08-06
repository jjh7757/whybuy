import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/kis";

export const dynamic = "force-dynamic";

// 회고 화면 한 번에 조회할 종목 수 상한입니다.
// 상한이 없으면 주문이 쌓였을 때 Vercel 10초 제한에 걸립니다.
const MAX_CODES = 20;

/**
 * 종목코드 여러 개의 현재가를 반환합니다.
 *
 * 🔴 개별 종목 조회가 실패해도 200으로 응답하고 그 종목만 null로 둡니다.
 * 회고 목록은 이미 화면에 그려져 있고 현재가는 그 위에 얹는 부가 정보이기
 * 때문입니다(WBS 4.2: KIS 실패 시 `—`로 표시되고 목록은 남는다).
 */
export async function POST(request: Request) {
  let codes: string[];
  try {
    const body = await request.json();
    codes = Array.isArray(body.codes) ? body.codes : [];
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const unique = [...new Set(codes)]
    .filter((c) => typeof c === "string" && /^[0-9A-Z]{6}$/.test(c))
    .slice(0, MAX_CODES);

  const { prices, timedOut } = await getQuotes(unique);

  return NextResponse.json({
    prices,
    truncated: codes.length > MAX_CODES,
    timedOut,
  });
}
