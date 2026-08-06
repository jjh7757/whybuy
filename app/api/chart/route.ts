import { NextResponse } from "next/server";
import { getCloses, isChartRange, type ChartRange } from "@/lib/kis";

export const dynamic = "force-dynamic";

type Point = { label: string; close: number };

/**
 * 🔴 종목+구간별로 캐시합니다. 일봉은 하루에 한 번 확정되는 값이라
 * 같은 종목을 다시 열 때마다 KIS를 부르면 한도(EGW00201)만 축냅니다.
 * 장중에는 마지막 봉이 조금씩 움직이므로 60초면 충분합니다.
 *
 * "일"(오늘 분봉)만 TTL을 3분으로 더 둡니다. 다른 구간은 KIS 호출 1회로
 * 끝나지만, 분봉은 하루치를 채우는 데 최대 13번을 호출합니다 — 같은 비용을
 * 60초마다 다시 치르게 하면 낭비가 큽니다.
 */
const TTL_MS = 60_000;
const INTRADAY_TTL_MS = 180_000;
const cache = new Map<string, { at: number; closes: Point[] }>();
const inflight = new Map<string, Promise<Point[]>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code") ?? "";
  const rangeParam = params.get("period") ?? "D";

  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }
  if (!isChartRange(rangeParam)) {
    return NextResponse.json({ error: "구간이 올바르지 않습니다." }, { status: 400 });
  }
  const range: ChartRange = rangeParam;
  const key = `${code}:${range}`;
  const ttl = range === "D" ? INTRADAY_TTL_MS : TTL_MS;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return NextResponse.json({ closes: hit.closes });
  }

  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = getCloses(code, range);
      inflight.set(key, pending);
    }
    const closes = await pending;
    cache.set(key, { at: Date.now(), closes });
    return NextResponse.json({ closes });
  } catch (err) {
    console.error("[/api/chart]", err);
    // 차트는 부가 정보입니다. 실패해도 시세·주문은 그대로 동작해야 하므로
    // 화면이 조용히 차트만 감출 수 있도록 빈 배열을 돌려줍니다.
    if (hit) return NextResponse.json({ closes: hit.closes, stale: true });
    return NextResponse.json({ closes: [] });
  } finally {
    inflight.delete(key);
  }
}
