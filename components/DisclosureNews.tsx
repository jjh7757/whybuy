"use client";

import { useEffect, useState } from "react";

type Disclosure = { title: string; date: string; url: string };
type NewsItem = { title: string; date: string; url: string };

function Item({ tag, title, date, url }: { tag: string; title: string; date: string; url: string }) {
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 py-2 transition hover:bg-neutral-100"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500">
            {tag}
          </span>
          <span className="truncate text-sm underline-offset-2 hover:underline">{title}</span>
        </div>
        <span className="tnum shrink-0 text-xs text-neutral-400">{date}</span>
      </a>
    </li>
  );
}

/**
 * 공시(DART)·뉴스(Google) 원문 목록을 그대로 보여줍니다. AI 해석 프롬프트가
 * 참고하는 것과 같은 재료지만, 여기서는 해석 없이 사실만 나열합니다.
 */
export function DisclosureNews({ stockCode }: { stockCode: string }) {
  const [disclosures, setDisclosures] = useState<Disclosure[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  return (
    <ul className="flex flex-col divide-y divide-neutral-200 rounded-xl bg-neutral-50 px-4">
      {disclosures.map((d, i) => (
        <Item key={`d-${i}`} tag="공시" title={d.title} date={d.date} url={d.url} />
      ))}
      {news.map((n, i) => (
        <Item key={`n-${i}`} tag="뉴스" title={n.title} date={n.date} url={n.url} />
      ))}
    </ul>
  );
}
