import { NextResponse } from "next/server";
import { getFinancialRatios, type FinancialRatio } from "@/lib/kis";

export const dynamic = "force-dynamic";

/** 재무비율은 결산기마다 한 번만 바뀌므로 넉넉히 캐시합니다(배당과 같은 이유). */
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; ratios: FinancialRatio[] }>();
const inflight = new Map<string, Promise<FinancialRatio[]>>();

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ratios: hit.ratios });
  }

  try {
    let pending = inflight.get(code);
    if (!pending) {
      pending = getFinancialRatios(code);
      inflight.set(code, pending);
    }
    const ratios = await pending;
    cache.set(code, { at: Date.now(), ratios });
    return NextResponse.json({ ratios });
  } catch (err) {
    console.error("[/api/financial-ratio]", err);
    if (hit) return NextResponse.json({ ratios: hit.ratios, stale: true });
    return NextResponse.json({ ratios: [] });
  } finally {
    inflight.delete(code);
  }
}
