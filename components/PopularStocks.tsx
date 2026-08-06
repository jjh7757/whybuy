"use client";

import { useEffect, useState } from "react";

export type PopularStock = {
  stock_code: string;
  stock_name: string;
  market: string;
  price: number;
  change: number;
  changeRate: number;
  tradingValue: number;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

// 거래대금은 조 단위까지 갑니다. 원 단위로 쓰면 자릿수를 셀 수 없습니다.
function tradingValueText(v: number) {
  if (v >= 1_0000_0000_0000) return `${(v / 1_0000_0000_0000).toFixed(1)}조원`;
  return `${Math.round(v / 1_0000_0000).toLocaleString("ko-KR")}억원`;
}

/**
 * 지금 거래가 많은 종목을 순위로 보여줍니다.
 *
 * 🔴 검색을 첫 관문으로 두면 "무슨 종목을 사야 할지 모르는" 초보자는 시작조차
 * 못 합니다. 종목명을 이미 아는 사람만 쓸 수 있는 화면이 되기 때문입니다.
 * 목록에서 바로 고르는 길을 검색과 나란히 둡니다.
 */
export function PopularStocks({
  onSelect,
}: {
  onSelect: (stock: { stock_code: string; stock_name: string; market: string }) => void;
}) {
  const [rows, setRows] = useState<PopularStock[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/popular")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => alive && setRows(data.results))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    // 인기 목록이 없어도 검색으로 주문할 수 있으므로 화면을 막지 않습니다.
    return (
      <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
        인기 종목을 불러오지 못했습니다. 위에서 종목명으로 검색해보세요.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-neutral-100 px-4 py-3">
        <h2 className="font-bold">실시간 인기 종목</h2>
        {/* 🔴 "인기"가 좋은 종목이라는 뜻으로 읽히면 추천이 됩니다. 기준을 그대로 적습니다. */}
        <span className="text-xs text-neutral-400">코스피 거래대금 순</span>
      </div>

      {rows === null && (
        <div className="divide-y divide-neutral-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-4 w-4 animate-pulse rounded bg-neutral-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-neutral-100" />
              <div className="h-4 w-20 animate-pulse rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      )}

      {rows?.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          지금은 보여줄 종목이 없습니다. 종목명으로 검색해보세요.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ol className="divide-y divide-neutral-100">
          {rows.map((s, i) => (
            <li key={s.stock_code}>
              <button
                onClick={() =>
                  onSelect({
                    stock_code: s.stock_code,
                    stock_name: s.stock_name,
                    market: s.market,
                  })
                }
                // 행 안의 글자가 순위·거래대금·등락률로 잘게 나뉘어 있어
                // 읽어주는 이름이 뒤죽박죽이 됩니다. 한 문장으로 정리해 둡니다.
                aria-label={`${i + 1}위 ${s.stock_name} ${won(s.price)} ${s.changeRate}%`}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-neutral-50"
              >
                <span className="tnum w-5 shrink-0 text-sm font-medium text-neutral-400">
                  {i + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.stock_name}</span>
                  <span className="tnum block text-xs text-neutral-400">
                    거래대금 {tradingValueText(s.tradingValue)}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="tnum block font-medium">{won(s.price)}</span>
                  <span
                    className={`tnum block text-xs ${
                      s.change > 0
                        ? "text-red-600"
                        : s.change < 0
                          ? "text-blue-600"
                          : "text-neutral-400"
                    }`}
                  >
                    {s.change > 0 ? "+" : ""}
                    {s.changeRate}%
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
