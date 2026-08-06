"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AiExplain } from "@/components/AiExplain";

type Holding = {
  stockCode: string;
  stockName: string;
  qty: number;
  avgOrderPrice: number;
  orderedAmount: number;
  currentPrice: number | null;
  evalAmount: number | null;
  profitLoss: number | null;
  profitLossRate: number | null;
};

type Account =
  | { loggedIn: false }
  | {
      loggedIn: true;
      allocated: number;
      spent: number;
      remaining: number;
      holdings: Holding[];
      totalEvaluation: number | null;
      totalProfitLoss: number | null;
      partialPrices: boolean;
    };

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export function AccountCard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      })
      .then(setAccount)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />;
  }

  if (error || !account) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error ?? "계좌 정보를 불러오지 못했습니다."}
      </div>
    );
  }

  if (!account.loggedIn) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm text-neutral-600">
          로그인하면 내 예산과 주문이 여기에 표시됩니다.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          오른쪽 위의 [로그인] 버튼을 눌러주세요.
        </p>
      </div>
    );
  }

  const usedRate = Math.min(100, (account.spent / account.allocated) * 100);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5">
      <div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="내 모의 투자금" value={won(account.allocated)} />
          <Stat label="주문에 쓴 금액" value={won(account.spent)} />
          <Stat label="남은 예산" value={won(account.remaining)} />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-neutral-800"
            style={{ width: `${usedRate}%` }}
          />
        </div>
      </div>

      {account.holdings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-sm text-neutral-600">
            아직 이 서비스로 주문한 종목이 없습니다.
          </p>
          <Link
            href="/trade"
            className="mt-3 inline-block rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            종목 찾아보기
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Stat
              label="내 보유 평가액"
              value={
                account.totalEvaluation === null
                  ? "—"
                  : won(account.totalEvaluation)
              }
            />
            <Stat
              label="평가손익"
              value={
                account.totalProfitLoss === null
                  ? "—"
                  : won(account.totalProfitLoss)
              }
              tone={
                account.totalProfitLoss === null
                  ? undefined
                  : account.totalProfitLoss >= 0
                    ? "up"
                    : "down"
              }
            />
          </div>

          <ul className="flex flex-col gap-2 text-sm">
            {account.holdings.map((h) => (
              <li key={h.stockCode} className="flex justify-between gap-2">
                <span>
                  {h.stockName} · {h.qty}주
                  <span className="ml-1 text-neutral-400">
                    (주문가 {won(h.avgOrderPrice)})
                  </span>
                </span>
                <span
                  className={
                    h.profitLoss === null
                      ? "text-neutral-400"
                      : h.profitLoss >= 0
                        ? "text-red-600"
                        : "text-blue-600"
                  }
                >
                  {h.evalAmount === null
                    ? "—"
                    : `${won(h.evalAmount)} (${h.profitLossRate!.toFixed(2)}%)`}
                </span>
              </li>
            ))}
          </ul>

          {account.partialPrices && (
            <p className="text-xs text-neutral-400">
              일부 종목의 현재가를 불러오지 못해 —로 표시했습니다.
            </p>
          )}
        </>
      )}

      <p className="text-xs text-neutral-400">
        수량과 주문가는 이 서비스로 넣은 주문 기준입니다. 시장가 주문이라 실제
        체결가와 다를 수 있습니다.
      </p>

      <AiExplain target="account" />
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
