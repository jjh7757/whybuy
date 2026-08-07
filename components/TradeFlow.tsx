"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { REASON_TYPES } from "@/lib/rationale";
import { isValidTickPrice, priceTickSize } from "@/lib/market";
import { AiExplain } from "@/components/AiExplain";
import { DividendInfo } from "@/components/DividendInfo";
import { FinancialRatios } from "@/components/FinancialRatios";
import { PopularStocks } from "@/components/PopularStocks";
import { PriceChart } from "@/components/PriceChart";
import { RangeBar } from "@/components/RangeBar";
import { Tutorial, useTutorial, type TutorialStep } from "@/components/Tutorial";

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
  week52High: number | null;
  week52Low: number | null;
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
const TUTORIAL_KEY = "whybuy:tutorial-done";

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "search",
    selector: '[data-tutorial="search"]',
    title: "종목 찾기",
    body: "종목명을 검색하거나, 아래 인기 종목에서 골라보세요.",
  },
  {
    id: "stockSelected",
    selector: '[data-tutorial="stockSelected"]',
    title: "하나 골라볼까요?",
    body: "인기 종목 중 하나를 눌러보세요.",
    waitForAction: true,
  },
  {
    id: "quote",
    selector: '[data-tutorial="quote"]',
    title: "지금 얼마인가요",
    body: "현재가와 등락률이에요. 아래 차트·재무·배당 정보로 판단해보세요.",
  },
  {
    id: "qty",
    selector: '[data-tutorial="qty"]',
    title: "수량 정하기",
    body: "몇 주 살지 입력하세요. 예산 퍼센트 버튼으로 자동 계산할 수도 있어요.",
  },
  {
    id: "reason",
    selector: '[data-tutorial="reason"]',
    title: "왜 사려고 하나요",
    body: "근거를 골라야 주문할 수 있어요. 나중에 지난 근거 화면에서 되돌아볼 수 있습니다.",
  },
  {
    id: "submit",
    selector: '[data-tutorial="submit"]',
    title: "주문하기",
    body: "다 채웠다면 눌러보세요. 로그인이 안 돼 있으면 로그인부터 진행돼요.",
  },
];

// quote가 로딩되기 전엔 이 스텝들의 타겟이 DOM에 없습니다 — 시세 로딩 지연/실패를
// "화면 구조가 바뀜"으로 오인해 튜토리얼이 자동 스킵하지 않도록 구분합니다.
const QUOTE_GATED_TUTORIAL_STEP_IDS = new Set(["quote", "qty", "reason", "submit"]);

type Draft = {
  stockCode: string;
  stockName: string;
  qty: string;
  reasonType: string;
  reasonMemo: string;
  orderType: "market" | "limit";
  limitPrice: string;
};

type OrderResult =
  | { kind: "success"; orderNo: string; status: "filled" | "submitted" }
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
  const isTutorialStepBlocked = useCallback(
    (step: TutorialStep) => QUOTE_GATED_TUTORIAL_STEP_IDS.has(step.id) && !quote,
    [quote],
  );
  // 차트·호가 / 종목정보 — 주문 폼은 오른쪽에 고정이라 탭과 무관하게 항상 보입니다.
  const [infoTab, setInfoTab] = useState<"chart" | "info">("chart");

  // 주문 폼
  const [qty, setQty] = useState("");
  const [reasonType, setReasonType] = useState("");
  const [reasonMemo, setReasonMemo] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");

  // 확인 모달
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const restoredRef = useRef(false);
  const tutorial = useTutorial(TUTORIAL_STEPS, TUTORIAL_KEY);

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
      setOrderType(draft.orderType ?? "market");
      setLimitPrice(draft.limitPrice ?? "");

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
    tutorial.notify("stockSelected");
    setCandidates(null);
    setNotFound(false);
    setSelected(stock);
    setInfoTab("chart");
    setQty("");
    setReasonType("");
    setReasonMemo("");
    setOrderType("market");
    setLimitPrice("");
    setResult(null);
    fetchQuote(stock.stock_code);
    // 수량 퀵버튼이 남은 예산을 기준으로 계산하므로 미리 받아둡니다.
    // KIS를 부르지 않는 요청이라 시세 조회와 겹쳐도 한도에 영향이 없습니다.
    if (userId) fetchRemaining();
  }

  const qtyNum = Number(qty);
  const validQty = qty.trim() !== "" && Number.isInteger(qtyNum) && qtyNum > 0;
  const limitPriceNum = Number(limitPrice);
  const validLimitPrice =
    orderType === "market" ||
    (limitPrice.trim() !== "" &&
      Number.isInteger(limitPriceNum) &&
      isValidTickPrice(limitPriceNum));
  // 지정가는 사용자가 지정한 가격, 시장가는 현재가로 예상 금액을 계산합니다.
  const effectivePrice = orderType === "limit" ? limitPriceNum : (quote?.price ?? 0);
  const expectedAmount = validQty && validLimitPrice && quote ? qtyNum * effectivePrice : 0;
  const canSubmit = validQty && validLimitPrice && reasonType !== "" && quote !== null;

  async function fetchRemaining() {
    try {
      const res = await fetch("/api/budget");
      const data = await res.json();
      const value = data.loggedIn ? data.remaining : null;
      setRemaining(value);
      return value as number | null;
    } catch {
      setRemaining(null);
      return null;
    }
  }

  async function openConfirm() {
    setResult(null);
    await fetchRemaining();
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
        orderType,
        limitPrice,
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
          orderType,
          limitPrice: orderType === "limit" ? limitPriceNum : undefined,
        }),
      });
      const data = await res.json();
      setConfirming(false);
      if (data.ok) {
        setResult({ kind: "success", orderNo: data.orderNo, status: data.status });
        setQty("");
        setReasonType("");
        setReasonMemo("");
        setOrderType("market");
        setLimitPrice("");
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
      <Tutorial tutorial={tutorial} isBlocked={isTutorialStepBlocked} />

      <div className="flex items-center justify-between gap-2">
        <form onSubmit={search} data-tutorial="search" className="flex flex-1 gap-2">
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
        {!tutorial.active && (
          <button
            type="button"
            onClick={tutorial.start}
            className="shrink-0 text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-700 hover:underline"
          >
            둘러보기 다시 보기
          </button>
        )}
      </div>

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
        <div data-tutorial="stockSelected">
          <PopularStocks onSelect={selectStock} />
        </div>
      )}

      {selected && (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
          {/* 왼쪽: 이 종목이 어떤 상태인가 */}
          <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{selected.stock_name}</h2>
                <span className="tnum text-xs text-neutral-400">
                  {selected.stock_code}
                  {selected.market ? ` · ${selected.market}` : ""}
                </span>
              </div>
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
                <div data-tutorial="quote">
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

                {/* 토스증권처럼 차트·호가/종목정보를 탭으로 나누되, 주문 폼은
                    오른쪽 칼럼에 그대로 둬서 탭을 옮겨도 계속 주문할 수 있게 합니다. */}
                <div className="flex gap-1 border-b border-neutral-200">
                  {(
                    [
                      { value: "chart", label: "차트·호가" },
                      { value: "info", label: "종목정보" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setInfoTab(t.value)}
                      aria-pressed={infoTab === t.value}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                        infoTab === t.value
                          ? "border-neutral-900 text-neutral-900"
                          : "border-transparent text-neutral-400 hover:text-neutral-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {infoTab === "chart" && (
                  <>
                    <PriceChart stockCode={selected.stock_code} />

                    <div className="flex flex-col gap-3">
                      <RangeBar
                        label="오늘 범위"
                        low={quote.low}
                        high={quote.high}
                        current={quote.price}
                      />
                      {quote.week52Low !== null && quote.week52High !== null && (
                        <RangeBar
                          label="52주 범위"
                          low={quote.week52Low}
                          high={quote.week52High}
                          current={quote.price}
                        />
                      )}
                    </div>

                    {/* 🔴 AI 해석이 언급하는 값은 표에도 있어야 합니다. 한쪽에만 있으면
                        사용자가 "AI가 말한 BPS가 어디 있지" 하고 화면을 뒤지게 됩니다.
                        고가·저가는 위의 `오늘 범위` 막대가 대신하므로 여기서 뺐습니다. */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-neutral-50 p-4 text-sm sm:grid-cols-4">
                      <Metric label="시가" value={won(quote.open)} />
                      <Metric
                        label="거래량"
                        value={`${quote.volume.toLocaleString("ko-KR")}주`}
                      />
                      <Metric label="업종" value={quote.sector} />
                      <Metric label="PER" value={ratioLabel(quote.per)} />
                      <Metric label="PBR" value={ratioLabel(quote.pbr)} />
                      <Metric label="EPS" value={quote.eps === null ? "—" : won(quote.eps)} />
                      <Metric label="BPS" value={quote.bps === null ? "—" : won(quote.bps)} />
                    </div>

                    <AiExplain target="quote" stockCode={selected.stock_code} />
                  </>
                )}

                {infoTab === "info" && (
                  <>
                    <div>
                      <h3 className="mb-2 text-sm font-bold">재무</h3>
                      <FinancialRatios stockCode={selected.stock_code} />
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-bold">배당 정보</h3>
                      <DividendInfo stockCode={selected.stock_code} currentPrice={quote.price} />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* 오른쪽: 얼마나, 왜 살 것인가 */}
          {quote && (
            <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 lg:sticky lg:top-20">
              <div className="flex items-baseline justify-between">
                <h3 className="font-bold">주문</h3>
                {remaining !== null && (
                  <span className="tnum text-xs text-neutral-400">
                    남은 예산 {won(remaining)}
                  </span>
                )}
              </div>

              <div className="flex gap-1.5">
                {(
                  [
                    { value: "market", label: "시장가" },
                    { value: "limit", label: "지정가" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setOrderType(t.value);
                      // 처음 지정가로 바꿀 때는 현재가를 기본값으로 채워둡니다.
                      if (t.value === "limit" && limitPrice.trim() === "") {
                        setLimitPrice(String(quote.price));
                      }
                    }}
                    aria-pressed={orderType === t.value}
                    className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${
                      orderType === t.value
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {orderType === "limit" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-500">주문 가격</span>
                  <input
                    type="number"
                    min={1}
                    step={priceTickSize(limitPriceNum > 0 ? limitPriceNum : quote.price)}
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder={String(quote.price)}
                    className="tnum w-full rounded-xl border border-neutral-200 px-3 py-2 text-right text-lg font-medium outline-none transition focus:border-neutral-900"
                  />
                  {limitPrice.trim() !== "" && !validLimitPrice && (
                    <span className="text-xs text-red-600">
                      이 가격대는{" "}
                      {priceTickSize(limitPriceNum > 0 ? limitPriceNum : quote.price).toLocaleString(
                        "ko-KR",
                      )}
                      원 단위로만 지정할 수 있습니다.
                    </span>
                  )}
                  <span className="text-xs text-neutral-400">
                    이 가격이 될 때까지 체결되지 않을 수 있습니다. 대기중인 주문은 내 계좌에서
                    확인·취소할 수 있습니다.
                  </span>
                </label>
              )}

              <div className="flex flex-col gap-2" data-tutorial="qty">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-500">수량</span>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    className="tnum w-full rounded-xl border border-neutral-200 px-3 py-2 text-right text-lg font-medium outline-none transition focus:border-neutral-900"
                  />
                </label>

                {/* 남은 예산으로 몇 주까지 살 수 있는지 초보자가 직접 나눌 필요가 없게 합니다. */}
                {remaining !== null && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {[10, 25, 50, 100].map((pct) => {
                      const affordable =
                        effectivePrice > 0
                          ? Math.floor((remaining * (pct / 100)) / effectivePrice)
                          : 0;
                      return (
                        <button
                          key={pct}
                          type="button"
                          disabled={affordable < 1}
                          onClick={() => setQty(String(affordable))}
                          className="rounded-lg border border-neutral-200 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {pct === 100 ? "최대" : `${pct}%`}
                        </button>
                      );
                    })}
                  </div>
                )}

                {qty.trim() !== "" && !validQty && (
                  <span className="text-xs text-red-600">
                    1주 이상의 정수로 입력해주세요.
                  </span>
                )}
              </div>

              <div className="flex items-baseline justify-between border-y border-neutral-100 py-3">
                <span className="text-sm text-neutral-500">예상 주문금액</span>
                <span className="tnum font-bold">
                  {validQty ? won(expectedAmount) : "—"}
                </span>
              </div>

              <fieldset className="flex flex-col gap-1 text-sm" data-tutorial="reason">
                <legend className="mb-1.5 font-medium">
                  이 종목을 사려는 근거는 무엇인가요?
                </legend>
                {REASON_TYPES.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                      reasonType === r.value ? "bg-neutral-100" : "hover:bg-neutral-50"
                    }`}
                  >
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
              </fieldset>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-500">메모 (선택)</span>
                <textarea
                  value={reasonMemo}
                  onChange={(e) => setReasonMemo(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-neutral-200 px-3 py-2 outline-none transition focus:border-neutral-900"
                />
              </label>

              <button
                onClick={handleOrderClick}
                disabled={!canSubmit}
                data-tutorial="submit"
                className="w-full rounded-xl bg-red-600 py-3 font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
              >
                주문하기
              </button>

              {/* 🔴 버튼을 왜 못 누르는지 말해주지 않으면 사용자는 고장으로 봅니다. */}
              {!canSubmit && (
                <p className="-mt-2 text-center text-xs text-neutral-400">
                  {!validQty
                    ? "수량을 입력해주세요."
                    : !validLimitPrice
                      ? "주문 가격을 입력해주세요."
                      : "근거를 선택해야 주문할 수 있습니다."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {result?.kind === "success" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {result.status === "filled"
            ? `주문이 체결되었습니다. (주문번호 ${result.orderNo})`
            : `지정가 주문이 접수되어 대기중입니다. (주문번호 ${result.orderNo}) 체결 확인·취소는 내 계좌에서 할 수 있습니다.`}{" "}
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
          orderType={orderType}
          price={effectivePrice}
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
  orderType,
  price,
  expectedAmount,
  reasonLabel,
  remaining,
  submitting,
  onCancel,
  onConfirm,
}: {
  stockName: string;
  qty: number;
  orderType: "market" | "limit";
  price: number;
  expectedAmount: number;
  reasonLabel: string;
  remaining: number | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const after = remaining === null ? null : remaining - expectedAmount;
  const priceLabel = orderType === "market" ? "시장가" : `지정가 ${won(price)}`;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <h3 className="font-medium">주문을 확인해주세요</h3>
        <p className="mt-3 text-sm leading-relaxed">
          {stockName} {qty}주 · {priceLabel} · 예상 {won(expectedAmount)} · 근거: {reasonLabel}
          {orderType === "limit" && (
            <>
              <br />
              지정한 가격이 될 때까지 체결되지 않을 수 있습니다.
            </>
          )}
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
