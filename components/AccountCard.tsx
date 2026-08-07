"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

type PendingOrder = {
  id: number;
  stockCode: string;
  stockName: string;
  qty: number;
  filledQty: number;
  limitPrice: number;
  createdAt: string;
};

type Account =
  | { loggedIn: false }
  | {
      loggedIn: true;
      allocated: number;
      spent: number;
      remaining: number;
      holdings: Holding[];
      pendingOrders: PendingOrder[];
      totalEvaluation: number | null;
      totalProfitLoss: number | null;
      partialPrices: boolean;
    };

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export function AccountCard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const res = await fetch("/api/account");
    if (!res.ok) throw new Error((await res.json()).error);
    setAccount(await res.json());
  }, []);

  useEffect(() => {
    loadAccount()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadAccount]);

  // 자동 폴링은 하지 않습니다(기획서 Won't Have인 "실시간 알림·스케줄러"와 같은
  // 이유) — 사용자가 버튼을 눌렀을 때만 KIS에 체결 여부를 물어봅니다.
  async function checkFill(id: number) {
    setActingId(id);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/order/${id}/check-fill`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setActionMessage(data.message ?? "체결 확인에 실패했습니다.");
      } else if (data.status === "filled") {
        setActionMessage("체결되었습니다.");
      } else {
        setActionMessage(
          `아직 대기중입니다. (체결 ${data.filledQty}주 · 잔여 ${data.remainingQty}주)`,
        );
      }
      await loadAccount();
    } catch {
      setActionMessage("체결 확인 요청을 보내지 못했습니다.");
    } finally {
      setActingId(null);
    }
  }

  async function cancelPending(id: number) {
    setActingId(id);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/order/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      setActionMessage(data.ok ? "주문을 취소했습니다." : data.message ?? "취소에 실패했습니다.");
      await loadAccount();
    } catch {
      setActionMessage("취소 요청을 보내지 못했습니다.");
    } finally {
      setActingId(null);
    }
  }

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

      {actionMessage && (
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {actionMessage}
        </p>
      )}

      {account.pendingOrders.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-500">
            대기중인 지정가 주문
          </h3>
          <ul className="flex flex-col gap-2">
            {account.pendingOrders.map((o) => {
              const remainingQty = o.qty - o.filledQty;
              const acting = actingId === o.id;
              return (
                <li
                  key={o.id}
                  className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    {o.stockName} · 잔여 {remainingQty}주
                    <span className="ml-1 text-neutral-400">
                      (지정가 {won(o.limitPrice)}
                      {o.filledQty > 0 ? ` · ${o.filledQty}주 부분체결` : ""})
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => checkFill(o.id)}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
                    >
                      체결 확인
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => cancelPending(o.id)}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      취소
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

          <ul className="flex flex-col gap-1 text-sm">
            {account.holdings.map((h) => (
              <li key={h.stockCode}>
                <Link
                  href={`/trade?code=${h.stockCode}&name=${encodeURIComponent(h.stockName)}`}
                  className="-mx-2 flex justify-between gap-2 rounded-lg px-2 py-1 transition hover:bg-neutral-50"
                >
                  <span>
                    {h.stockName} · {h.qty}주
                    <span className="ml-1 text-neutral-400">
                      (체결가 {won(h.avgOrderPrice)})
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
                </Link>
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
        수량과 체결가는 이 서비스로 넣은 주문 기준입니다. 시장가 주문은 접수
        시점의 시세를 체결가로 간주합니다.
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
