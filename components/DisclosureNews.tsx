"use client";

import { useEffect, useState } from "react";

type Disclosure = { title: string; date: string; url: string };
type NewsItem = { title: string; date: string; url: string };

function Row({ title, date, url, sub }: { title: string; date: string; url: string; sub?: string }) {
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 px-1 py-2.5 transition hover:bg-neutral-100"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium underline-offset-2 hover:underline">{title}</div>
          {sub && <div className="mt-0.5 truncate text-xs text-neutral-500">{sub}</div>}
        </div>
        <span className="tnum shrink-0 pt-0.5 text-xs text-neutral-400">{date}</span>
      </a>
    </li>
  );
}

// "2026.07.31" → 2026
const yearOf = (date: string) => Number(date.slice(0, 4));
// "2026.07.31" → "7월 31일"
const monthDay = (date: string) => {
  const [, m, d] = date.split(".");
  return `${Number(m)}월 ${Number(d)}일`;
};

/**
 * 공시(DART)·뉴스(Google) 원문 목록을 그대로 보여줍니다. AI 해석 프롬프트가
 * 참고하는 것과 같은 재료지만, 여기서는 해석 없이 사실만 나열합니다.
 *
 * 뉴스/공시를 별도 탭으로 나눈 이유: 성격이 다른 두 목록(공시는 몇 년치를
 * 연도별로 훑어보는 용도, 뉴스는 최근 흐름을 훑어보는 용도)을 한 목록에
 * 섞으면 어느 쪽도 제대로 훑어보기 어렵습니다.
 */
export function DisclosureNews({ stockCode }: { stockCode: string }) {
  const [disclosures, setDisclosures] = useState<Disclosure[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [subTab, setSubTab] = useState<"news" | "disclosure">("news");

  useEffect(() => {
    let alive = true;
    setDisclosures(null);
    setNews(null);
    setFailed(false);
    fetch(`/api/disclosures?code=${stockCode}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDisclosures(d.disclosures ?? []);
        setNews(d.news ?? []);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [stockCode]);

  if (failed) return null;

  if (disclosures === null || news === null) {
    return <div className="h-20 animate-pulse rounded-xl bg-neutral-100" />;
  }

  if (disclosures.length === 0 && news.length === 0) {
    return (
      <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500">
        최근 공시·뉴스가 없습니다.
      </div>
    );
  }

  // 공시만 연도별로 묶습니다. 뉴스는 전부 최근이라 묶을 필요가 없습니다.
  const years = [...new Set(disclosures.map((d) => yearOf(d.date)))].sort((a, b) => b - a);

  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <div className="mb-1 flex gap-1">
        {(
          [
            { value: "news", label: "뉴스" },
            { value: "disclosure", label: "공시" },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setSubTab(t.value)}
            aria-pressed={subTab === t.value}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              subTab === t.value
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "news" &&
        (news.length === 0 ? (
          <p className="p-3 text-sm text-neutral-500">최근 뉴스가 없습니다.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {news.map((n, i) => (
              <Row key={i} title={n.title} date={n.date} url={n.url} />
            ))}
          </ul>
        ))}

      {subTab === "disclosure" &&
        (disclosures.length === 0 ? (
          <p className="p-3 text-sm text-neutral-500">최근 공시가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {years.map((year) => (
              <div key={year}>
                <div className="px-1 pt-2 text-xs font-medium text-neutral-400">{year}년</div>
                <ul className="flex flex-col divide-y divide-neutral-200">
                  {disclosures
                    .filter((d) => yearOf(d.date) === year)
                    .map((d, i) => (
                      <Row key={i} title={d.title} date={monthDay(d.date)} url={d.url} />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
