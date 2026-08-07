"use client";

import { useEffect, useState } from "react";

type Dividend = {
  recordDate: string;
  payDate: string;
  kind: string;
  perShare: number;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="tnum truncate font-medium">{value}</div>
    </div>
  );
}

/**
 * 최근 배당 이력을 보여줍니다. "배당을 기대"(REASON_TYPES)로 주문하려는
 * 사람이 실제로 배당을 얼마나·언제 받아왔는지 확인할 근거입니다.
 */
export function DividendInfo({
  stockCode,
  currentPrice,
}: {
  stockCode: string;
  currentPrice: number;
}) {
  const [dividends, setDividends] = useState<Dividend[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setDividends(null);
    setFailed(false);
    fetch(`/api/dividend?code=${stockCode}`)
      .then((r) => r.json())
      .then((d) => alive && setDividends(d.dividends ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [stockCode]);

  if (failed) return null;

  if (dividends === null) {
    return <div className="h-20 animate-pulse rounded-xl bg-neutral-100" />;
  }

  if (dividends.length === 0) {
    return (
      <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500">
        최근 2년간 배당 이력이 없습니다.
      </div>
    );
  }

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoff = `${oneYearAgo.getFullYear()}.${String(oneYearAgo.getMonth() + 1).padStart(2, "0")}.${String(
    oneYearAgo.getDate(),
  ).padStart(2, "0")}`;

  const recent = dividends.filter((d) => d.recordDate >= cutoff);
  const totalPerShare = recent.reduce((s, d) => s + d.perShare, 0);
  const yieldPct = currentPrice > 0 ? (totalPerShare / currentPrice) * 100 : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="최근 12개월 배당" value={`${recent.length}번`} />
        <Stat label="주당 배당금 합계" value={won(totalPerShare)} />
        <Stat label="배당수익률" value={yieldPct === null ? "—" : `${yieldPct.toFixed(2)}%`} />
      </div>

      <ul className="flex flex-col divide-y divide-neutral-200 text-sm">
        {dividends.slice(0, 5).map((d, i) => (
          <li key={`${d.recordDate}-${i}`} className="flex items-center justify-between py-1.5">
            <span className="text-neutral-500">
              {d.payDate || d.recordDate}
              <span className="ml-1.5 text-xs text-neutral-400">{d.kind}</span>
            </span>
            <span className="tnum font-medium">{won(d.perShare)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
