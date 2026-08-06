"use client";

import { useEffect, useState } from "react";

type Balance = {
  deposit: number;
  totalEvaluation: number;
  totalProfitLoss: number;
  holdings: Array<{
    stockCode: string;
    stockName: string;
    qty: number;
    avgPrice: number;
    evalAmount: number;
    profitLoss: number;
    profitLossRate: number;
  }>;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export function AccountCard() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      })
      .then(setBalance)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
    );
  }

  if (error || !balance) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error ?? "계좌 정보를 불러오지 못했습니다."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="예수금" value={won(balance.deposit)} />
        <Stat label="총평가금액" value={won(balance.totalEvaluation)} />
        <Stat
          label="평가손익"
          value={won(balance.totalProfitLoss)}
          tone={balance.totalProfitLoss >= 0 ? "up" : "down"}
        />
      </div>

      {balance.holdings.length === 0 ? (
        <p className="text-sm text-neutral-500">보유 중인 종목이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {balance.holdings.map((h) => (
            <li key={h.stockCode} className="flex justify-between">
              <span>
                {h.stockName} · {h.qty}주
              </span>
              <span className={h.profitLoss >= 0 ? "text-red-600" : "text-blue-600"}>
                {won(h.evalAmount)} ({h.profitLossRate.toFixed(2)}%)
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up" ? "text-red-600" : tone === "down" ? "text-blue-600" : "";
  return (
    <div>
      <div className="text-neutral-500">{label}</div>
      <div className={`font-medium ${color}`}>{value}</div>
    </div>
  );
}
