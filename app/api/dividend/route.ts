import { NextResponse } from "next/server";
import { getDividends, type Dividend } from "@/lib/kis";

export const dynamic = "force-dynamic";

/**
 * 배당 이력은 장중에도 거의 바뀌지 않으므로 넉넉히 캐시합니다(차트·시세와 같은
 * KIS 호출 큐를 나눠 쓰므로, 자주 열어도 EGW00201 예산을 낭비하지 않기 위함).
 */
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; dividends: Dividend[] }>();
const inflight = new Map<string, Promise<Dividend[]>>();

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ dividends: hit.dividends });
  }

  try {
    let pending = inflight.get(code);
    if (!pending) {
      pending = getDividends(code);
      inflight.set(code, pending);
    }
    const dividends = await pending;
    cache.set(code, { at: Date.now(), dividends });
    return NextResponse.json({ dividends });
  } catch (err) {
    console.error("[/api/dividend]", err);
    // 배당 정보는 부가 정보입니다. 실패해도 시세·주문은 그대로 동작해야 합니다.
    if (hit) return NextResponse.json({ dividends: hit.dividends, stale: true });
    return NextResponse.json({ dividends: [] });
  } finally {
    inflight.delete(code);
  }
}
