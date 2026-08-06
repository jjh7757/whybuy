"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { REASON_TYPES } from "@/lib/rationale";
import { AiExplain } from "@/components/AiExplain";
import { PopularStocks } from "@/components/PopularStocks";

type StockOption = { stock_code: string; stock_name: string; market: string };
type Quote = {
  stockCode: string;
  price: number;
  change: number;
  changeRate: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  sector: string;
  market: string;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/**
 * PER·PBR을 표시합니다. KIS가 값을 주지 않으면 `—`입니다.
 *
 * 적자 기업의 음수 PER도 증권사 앱들처럼 그대로 보여줍니다. 값을 가리는 대신
 * AI 해석이 "마이너스는 낮아서 싼 것이 아니다"를 설명하는 쪽을 택했습니다.
 */
const ratioLabel = (v: number | null) => (v === null ? "—" : `${v}배`);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="tnum truncate font-medium">{value}</div>
    </div>
  );
}

// 예외 2.3: 검색 결과가 0건일 때 보여줄 예시입니다. 실제 stocks 테이블에 있는 종목만 씁니다.
const EXAMPLES: StockOption[] = [
  { stock_code: "005930", stock_name: "삼성전자", market: "KOSPI" },
  { stock_code: "000660", stock_name: "SK하이닉스", market: "KOSPI" },
  { stock_code: "035420", stock_name: "NAVER", market: "KOSPI" },
  { stock_code: "035720", stock_name: "카카오", market: "KOSPI" },
  { stock_code: "005380", stock_name: "현대차", market: "KOSPI" },
];

const DRAFT_KEY = "whybuy:pending-order";

type Draft = {
  stockCode: string;
  stockName: string;
  qty: string;
  reasonType: string;
  reasonMemo: string;
};

type OrderResult =
  | { kind: "success"; orderNo: string }
  | { kind: "failed"; message: string };

export function TradeFlow() {
  const supabase = useRef(createClient()).current;
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  // 검색
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<StockOption[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searchError, setSearchError] = useState(false);

  // 선택된 종목 + 시세
  const [selected, setSelected] = useState<StockOption | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState(false);

  // 주문 폼
  const [qty, setQty] = useState("");
  const [reasonType, setReasonType] = useState("");
  const [reasonMemo, setReasonMemo] = useState("");

  // 확인 모달
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const restoredRef = useRef(false);

  // 로그인 상태를 구독하고, 로그인된 시점에 대기 중인 주문 초안이 있으면 복원합니다.
  //
  // 🔴 두 일을 한 effect에 묶은 이유: 복원은 "userId가 바뀌었다"는 사실 자체가 아니라
  // "로그인 콜백이 막 들어왔다"는 이벤트에 반응해야 합니다. userId를 의존성으로 하는
  // 별도 effect로 나누면 effect 본문에서 곧장 setState를 호출하게 되어 렌더가
  // 연쇄적으로 겹칩니다. 콜백 안에서 처리하면 이 문제가 없습니다.
  useEffect(() => {
    function handleUser(uid: string | null) {
      setUserId(uid);
      if (!uid || restoredRef.current) return;
      restoredRef.current = true;

      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(DRAFT_KEY);

      let draft: Draft;
      try {
        draft = JSON.parse(raw);
      } catch {
        return;
      }

      setSelected({ stock_code: draft.stockCode, stock_name: draft.stockName, market: "" });
      setQty(draft.qty);
      setReasonType(draft.reasonType);
      setReasonMemo(draft.reasonMemo);

      fetchQuote(draft.stockCode);
      openConfirm();
    }

    supabase.auth.getUser().then(({ data }) => handleUser(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      handleUser(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function fetchQuote(code: string) {
    setQuote(null);
    setQuoteError(false);
    try {
      const res = await fetch(`/api/quote?code=${code}`);
      if (!res.ok) throw new Error();
      setQuote(await res.json());
    } catch {
      setQuoteError(true);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    // 예외 2.9: 빈 검색어는 서버를 호출하지 않습니다.
    if (!q) return;

    setSearching(true);
    setSearchError(false);
    setNotFound(false);
    setCandidates(null);
    setSelected(null);
    setResult(null);

    try {
      const res = await fetch(`/api/stocks?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const results: StockOption[] = data.results;

      if (results.length === 0) {
        setNotFound(true);
      } else if (results.length === 1) {
        selectStock(results[0]);
      } else {
        setCandidates(results);
      }
    } catch {
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }

  // 종목을 하나 고르면 인기 목록이 사라지므로, 되돌아갈 길을 남깁니다.
  function backToList() {
    setSelected(null);
    setQuote(null);
    setQuoteError(false);
    setQuery("");
    setResult(null);
  }

  function selectStock(stock: StockOption) {
    setCandidates(null);
    setNotFound(false);
    setSelected(stock);
    setQty("");
    setReasonType("");
    setReasonMemo("");
    setResult(null);
    fetchQuote(stock.stock_code);
  }

  const qtyNum = Number(qty);
  const validQty = qty.trim() !== "" && Number.isInteger(qtyNum) && qtyNum > 0;
  const expectedAmount = validQty && quote ? qtyNum * quote.price : 0;
  const canSubmit = validQty && reasonType !== "" && quote !== null;

  async function openConfirm() {
    setResult(null);
    try {
      const res = await fetch("/api/account");
      const data = await res.json();
      setRemaining(data.loggedIn ? data.remaining : null);
    } catch {
      setRemaining(null);
    }
    setConfirming(true);
  }

  function handleOrderClick() {
    if (!canSubmit || !selected) return;

    // 예외 2.10: 로그인하지 않았으면 폼을 저장해두고 로그인부터 시킵니다.
    if (!userId) {
      const draft: Draft = {
        stockCode: selected.stock_code,
        stockName: selected.stock_name,
        qty,
        reasonType,
        reasonMemo,
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback?next=/trade` },
      });
      return;
    }

    openConfirm();
  }

  async function submitOrder() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stockCode: selected.stock_code,
          qty: qtyNum,
          reasonType,
          reasonMemo,
        }),
      });
      const data = await res.json();
      setConfirming(false);
      if (data.ok) {
        setResult({ kind: "success", orderNo: data.orderNo });
        setQty("");
        setReasonType("");
        setReasonMemo("");
      } else {
        setResult({ kind: "failed", message: data.message ?? "주문에 실패했습니다." });
      }
    } catch {
      setConfirming(false);
      setResult({ kind: "failed", message: "주문 요청을 보내지 못했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명을 입력하세요 (예: 삼성전자)"
          className="flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          검색
        </button>
      </form>

      {searchError && (
        <p className="text-sm text-red-600">검색하지 못했습니다. 다시 시도해주세요.</p>
      )}

      {notFound && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          <p>코스피 상위 종목만 지원합니다. 다른 종목명으로 검색해보세요.</p>
          <p className="mt-2 text-neutral-500">예시:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((s) => (
              <button
                key={s.stock_code}
                onClick={() => selectStock(s)}
                className="rounded-lg border border-neutral-200 px-2.5 py-1 transition hover:bg-neutral-100"
              >
                {s.stock_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {candidates && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-sm text-neutral-500">
            결과가 여러 건입니다. 하나를 골라주세요.
          </p>
          <div className="flex flex-col gap-0.5">
            {candidates.map((c) => (
              <button
                key={c.stock_code}
                onClick={() => selectStock(c)}
                className="rounded-lg px-3 py-2 text-left text-sm transition hover:bg-neutral-50"
              >
                <span className="font-medium">{c.stock_name}</span>{" "}
                <span className="tnum text-neutral-400">({c.stock_code})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 검색·후보·선택이 모두 없는 첫 상태에서만 인기 종목을 보여줍니다. */}
      {!selected && !candidates && !notFound && (
        <PopularStocks onSelect={selectStock} />
      )}

      {selected && (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">{selected.stock_name}</h2>
            <button
              onClick={backToList}
              className="shrink-0 text-sm text-neutral-400 transition hover:text-neutral-900"
            >
              목록으로
            </button>
          </div>

          {quoteError && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-red-600">시세를 불러오지 못했습니다.</span>
              <button
                onClick={() => fetchQuote(selected.stock_code)}
                className="rounded-lg border border-neutral-200 px-2.5 py-1 transition hover:bg-neutral-100"
              >
                다시 시도
              </button>
            </div>
          )}

          {!quote && !quoteError && (
            <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
          )}

          {quote && (
            <>
              <div>
                <div className="tnum text-3xl font-bold">{won(quote.price)}</div>
                <div
                  className={`tnum mt-1 text-sm font-medium ${
                    quote.change > 0
                      ? "text-red-600"
                      : quote.change < 0
                        ? "text-blue-600"
                        : "text-neutral-400"
                  }`}
                >
                  {quote.change > 0 ? "+" : ""}
                  {won(quote.change)} ({quote.changeRate}%)
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-neutral-50 p-4 text-sm sm:grid-cols-3">
                <Metric label="거래량" value={`${quote.volume.toLocaleString("ko-KR")}주`} />
                <Metric label="업종" value={quote.sector} />
                <Metric label="PER" value={ratioLabel(quote.per)} />
                <Metric label="PBR" value={ratioLabel(quote.pbr)} />
                <Metric label="EPS" value={quote.eps === null ? "—" : won(quote.eps)} />
                <Metric label="BPS" value={quote.bps === null ? "—" : won(quote.bps)} />
              </div>

              <AiExplain target="quote" stockCode={selected.stock_code} />

              <hr className="border-neutral-100" />

              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-500">수량</span>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-32 rounded border border-neutral-300 px-2 py-1.5"
                  />
                  {qty.trim() !== "" && !validQty && (
                    <span className="text-xs text-red-600">
                      1주 이상의 정수로 입력해주세요.
                    </span>
                  )}
                  {validQty && (
                    <span className="text-xs text-neutral-500">
                      예상 주문금액 {won(expectedAmount)}
                    </span>
                  )}
                </label>

                <fieldset className="flex flex-col gap-1.5 text-sm">
                  <legend className="mb-1 text-neutral-500">
                    이 종목을 사려는 근거는 무엇인가요?
                  </legend>
                  {REASON_TYPES.map((r) => (
                    <label key={r.value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="reasonType"
                        value={r.value}
                        checked={reasonType === r.value}
                        onChange={() => setReasonType(r.value)}
                      />
                      {r.label}
                    </label>
                  ))}
                  {reasonType === "" && (
                    <span className="text-xs text-neutral-400">
                      근거를 선택해야 주문할 수 있습니다.
                    </span>
                  )}
                </fieldset>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-500">메모 (선택)</span>
                  <textarea
                    value={reasonMemo}
                    onChange={(e) => setReasonMemo(e.target.value)}
                    rows={2}
                    className="rounded border border-neutral-300 px-2 py-1.5"
                  />
                </label>

                <button
                  onClick={handleOrderClick}
                  disabled={!canSubmit}
                  className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  주문하기
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {result?.kind === "success" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          주문이 접수되었습니다. (주문번호 {result.orderNo}){" "}
          <Link href="/journal" className="underline">
            회고 화면에서 보기
          </Link>
        </div>
      )}
      {result?.kind === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.message}
        </div>
      )}

      {confirming && selected && quote && (
        <ConfirmModal
          stockName={selected.stock_name}
          qty={qtyNum}
          expectedAmount={expectedAmount}
          reasonLabel={REASON_TYPES.find((r) => r.value === reasonType)?.label ?? ""}
          remaining={remaining}
          submitting={submitting}
          onCancel={() => setConfirming(false)}
          onConfirm={submitOrder}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  stockName,
  qty,
  expectedAmount,
  reasonLabel,
  remaining,
  submitting,
  onCancel,
  onConfirm,
}: {
  stockName: string;
  qty: number;
  expectedAmount: number;
  reasonLabel: string;
  remaining: number | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const after = remaining === null ? null : remaining - expectedAmount;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <h3 className="font-medium">주문을 확인해주세요</h3>
        <p className="mt-3 text-sm leading-relaxed">
          {stockName} {qty}주 · 예상 {won(expectedAmount)} · 근거: {reasonLabel}
          {after !== null && (
            <>
              <br />이 주문 후 남는 예산: {won(after)}
            </>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {submitting ? "주문 중…" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
