import { NextResponse } from "next/server";
import { getQuote } from "@/lib/kis";

export const dynamic = "force-dynamic";

// 회고 화면 한 번에 조회할 종목 수 상한입니다.
const MAX_CODES = 20;

// KIS는 짧은 간격의 연속 호출을 EGW00201(초당 거래건수 초과)로 거부합니다.
// 250ms에서는 멀쩡한 종목도 실패했습니다. 400ms + 실패 시 1회 재시도로 걸러냅니다.
const GAP_MS = 400;
const RETRY_BACKOFF_MS = 900;

// Vercel 함수 제한이 10초이므로 그 전에 남은 종목을 포기합니다.
// 포기한 종목은 null이 되어 화면에 `—`로 나갑니다.
const DEADLINE_MS = 7000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const prices: Record<string, number | null> = {};
  const startedAt = Date.now();
  let timedOut = false;

  for (let i = 0; i < unique.length; i++) {
    const code = unique[i];

    if (Date.now() - startedAt > DEADLINE_MS) {
      prices[code] = null;
      timedOut = true;
      continue;
    }

    prices[code] = await fetchWithRetry(code);

    if (i < unique.length - 1) await sleep(GAP_MS);
  }

  return NextResponse.json({
    prices,
    truncated: codes.length > MAX_CODES,
    timedOut,
  });
}

/**
 * 레이트리밋 실패와 "존재하지 않는 종목"은 구분할 수 없으므로 일단 재시도합니다.
 * 재시도해도 실패하면 그때 null로 확정합니다.
 */
async function fetchWithRetry(code: string): Promise<number | null> {
  try {
    return (await getQuote(code)).price;
  } catch {
    await sleep(RETRY_BACKOFF_MS);
    try {
      return (await getQuote(code)).price;
    } catch {
      return null;
    }
  }
}
