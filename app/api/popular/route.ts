import { NextResponse } from "next/server";
import { getPopularStocks } from "@/lib/kis";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// KIS 순위 API가 한 번에 주는 최대치가 30건입니다. 그중 우리가 지원하는 종목만
// 남기므로 실제로는 보통 29건이 나갑니다. 순위가 붙어 있어 위에서부터 읽으면 되므로
// 줄 수가 늘어도 "무엇을 눌러야 하는지 모르는" 상태(REQ-05)가 되지는 않습니다.
const TOP_N = 30;

type Row = {
  stock_code: string;
  stock_name: string;
  market: string;
  price: number;
  change: number;
  changeRate: number;
  tradingValue: number;
};

/**
 * 🔴 인기 목록은 캐시합니다. 없으면 EGW00201(초당 거래건수 초과)로 실패합니다.
 *
 * 이 화면은 사람이 들어올 때마다 호출됩니다. 시연처럼 여러 명이 동시에 열거나
 * 한 사람이 새로고침을 몇 번 하면 곧바로 한도에 걸립니다(실제로 걸렸습니다).
 * 순위는 초 단위로 바뀌는 값이 아니므로 잠깐 묵혀도 뜻이 상하지 않습니다.
 */
const TTL_MS = 15_000;
let cache: { at: number; rows: Row[] } | null = null;
// 동시에 들어온 요청이 각자 KIS를 부르지 않도록 진행 중인 조회를 공유합니다.
let inflight: Promise<Row[]> | null = null;

/**
 * 흐름 C의 진입점: 지금 거래가 활발한 종목 목록입니다.
 *
 * 🔴 KIS 순위 결과를 그대로 내보내지 않고 `stocks` 테이블에 있는 종목만 남깁니다.
 * 우리가 시세·주문을 지원하는 종목이 아니면 눌러도 막다른 길이 되기 때문입니다.
 * 순위 자체는 KIS가 준 순서를 유지합니다.
 */
async function load(): Promise<Row[]> {
  const ranked = await getPopularStocks();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stocks")
    .select("stock_code, stock_name, market")
    .eq("is_active", true)
    .in(
      "stock_code",
      ranked.map((r) => r.stockCode),
    );

  if (error) throw new Error(`종목 대조 실패: ${error.message}`);

  const supported = new Map((data ?? []).map((s) => [s.stock_code, s]));

  // 종목명은 stocks 테이블 값을 씁니다. KIS 순위가 주는 이름은 검색 결과와
  // 표기가 달라(축약·공백) 같은 종목이 다른 이름으로 보이는 일이 있습니다.
  return ranked
    .filter((r) => supported.has(r.stockCode))
    .slice(0, TOP_N)
    .map((r) => ({
      stock_code: r.stockCode,
      stock_name: supported.get(r.stockCode)!.stock_name,
      market: supported.get(r.stockCode)!.market,
      price: r.price,
      change: r.change,
      changeRate: r.changeRate,
      tradingValue: r.tradingValue,
    }));
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ results: cache.rows });
  }

  try {
    inflight ??= load();
    const rows = await inflight;
    cache = { at: Date.now(), rows };
    return NextResponse.json({ results: rows });
  } catch (err) {
    console.error("[/api/popular] 순위 조회 실패", err);
    // 한도에 걸렸을 뿐이라면 조금 지난 목록이 빈 화면보다 낫습니다.
    if (cache) {
      return NextResponse.json({ results: cache.rows, stale: true });
    }
    return NextResponse.json(
      { error: "인기 종목을 불러오지 못했습니다." },
      { status: 502 },
    );
  } finally {
    inflight = null;
  }
}
