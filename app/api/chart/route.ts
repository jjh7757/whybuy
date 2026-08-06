import { NextResponse } from "next/server";
import { getDailyCloses } from "@/lib/kis";

export const dynamic = "force-dynamic";

/**
 * 🔴 종목별로 캐시합니다. 일봉은 하루에 한 번 확정되는 값이라
 * 같은 종목을 다시 열 때마다 KIS를 부르면 한도(EGW00201)만 축냅니다.
 * 장중에는 마지막 봉이 조금씩 움직이므로 60초면 충분합니다.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; closes: { date: string; close: number }[] }>();
const inflight = new Map<string, Promise<{ date: string; close: number }[]>>();

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ closes: hit.closes });
  }

  try {
    let pending = inflight.get(code);
    if (!pending) {
      pending = getDailyCloses(code);
      inflight.set(code, pending);
    }
    const closes = await pending;
    cache.set(code, { at: Date.now(), closes });
    return NextResponse.json({ closes });
  } catch (err) {
    console.error("[/api/chart]", err);
    // 차트는 부가 정보입니다. 실패해도 시세·주문은 그대로 동작해야 하므로
    // 화면이 조용히 차트만 감출 수 있도록 빈 배열을 돌려줍니다.
    if (hit) return NextResponse.json({ closes: hit.closes, stale: true });
    return NextResponse.json({ closes: [] });
  } finally {
    inflight.delete(code);
  }
}
