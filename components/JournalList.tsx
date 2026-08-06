"use client";

import { useEffect, useState } from "react";
import { reasonLabel } from "@/lib/rationale";

export type JournalRow = {
  id: number;
  stockCode: string;
  stockName: string;
  qty: number;
  expectedPrice: number;
  status: string;
  createdAt: string;
  reasonType: string | null;
  reasonMemo: string | null;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });

export function JournalList({ rows }: { rows: JournalRow[] }) {
  // null = 아직 못 받음 또는 조회 실패. 둘 다 화면에는 `—`로 나갑니다.
  const [prices, setPrices] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (rows.length === 0) return;
    const codes = [...new Set(rows.map((r) => r.stockCode))];

    fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codes }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setPrices(data.prices))
      .catch(() => {
        // 목록은 그대로 두고 현재가만 비웁니다.
      });
  }, [rows]);

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const now = prices[row.stockCode] ?? null;
        const diffRate =
          now !== null && row.expectedPrice > 0
            ? ((now - row.expectedPrice) / row.expectedPrice) * 100
            : null;

        return (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {row.stockName} · {row.qty}주
              </span>
              <span className="text-xs text-neutral-500">
                {day(row.createdAt)}
                {row.status === "rejected" && (
                  <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                    거부됨
                  </span>
                )}
              </span>
            </div>

            {/* 🔴 이 한 줄이 흐름 E의 전부입니다. 당시 가격이 없으면 회고가 성립하지 않습니다. */}
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-neutral-500">당시</span>
              <span>{won(row.expectedPrice)}</span>
              <span className="text-neutral-300">→</span>
              <span className="text-neutral-500">현재</span>
              <span>{now === null ? "—" : won(now)}</span>
              {diffRate !== null && (
                <span
                  className={
                    diffRate >= 0 ? "text-red-600" : "text-blue-600"
                  }
                >
                  ({diffRate >= 0 ? "+" : ""}
                  {diffRate.toFixed(2)}%)
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded bg-neutral-50 p-2.5">
              <span className="text-sm">
                <span className="text-neutral-500">근거 · </span>
                {reasonLabel(row.reasonType)}
              </span>
              {row.reasonMemo && (
                <span className="text-sm text-neutral-600">
                  “{row.reasonMemo}”
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
