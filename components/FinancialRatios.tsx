"use client";

import { useEffect, useState } from "react";

type FinancialRatio = {
  period: string;
  revenueGrowth: number | null;
  netIncomeGrowth: number | null;
  roe: number | null;
  debtRatio: number | null;
};

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="tnum truncate font-medium">{value}</div>
    </div>
  );
}

/**
 * 최근 결산연도별 부채비율·성장률을 보여줍니다. 재무제표를 읽는 법을 가르치는
 * 화면이 아니라서 대차대조표 원문 대신 이 4개 숫자만 추립니다.
 */
export function FinancialRatios({ stockCode }: { stockCode: string }) {
  const [ratios, setRatios] = useState<FinancialRatio[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRatios(null);
    setFailed(false);
    fetch(`/api/financial-ratio?code=${stockCode}`)
      .then((r) => r.json())
      .then((d) => alive && setRatios(d.ratios ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [stockCode]);

  if (failed) return null;

  if (ratios === null) {
    return <div className="h-20 animate-pulse rounded-xl bg-neutral-100" />;
  }

  if (ratios.length === 0) {
    return (
      <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500">
        재무 정보가 없습니다.
      </div>
    );
  }

  const latest = ratios[0];

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label={`부채비율 (${latest.period})`} value={pct(latest.debtRatio)} />
        <Stat label="ROE" value={pct(latest.roe)} />
        <Stat label="매출액증가율" value={pct(latest.revenueGrowth)} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-400">
            <th className="pb-1 font-normal">결산연월</th>
            <th className="pb-1 text-right font-normal">매출액증가율</th>
            <th className="pb-1 text-right font-normal">순이익증가율</th>
            <th className="pb-1 text-right font-normal">부채비율</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {ratios.slice(0, 5).map((r) => (
            <tr key={r.period}>
              <td className="tnum py-1.5 text-neutral-500">{r.period}</td>
              <td className="tnum py-1.5 text-right font-medium">{pct(r.revenueGrowth)}</td>
              <td className="tnum py-1.5 text-right font-medium">{pct(r.netIncomeGrowth)}</td>
              <td className="tnum py-1.5 text-right font-medium">{pct(r.debtRatio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
