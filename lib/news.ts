import "server-only";

export type NewsItem = { title: string; date: string; url: string };

/**
 * 날짜만으로는 최근 뉴스가 다 "오늘" 안에 몰려 있어 구분이 안 됩니다.
 * 공시(일 단위 날짜)와 달리 뉴스는 시각까지 있으므로 상대 시간으로 보여줍니다.
 */
function formatRelativeTime(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * 종목명으로 최근 뉴스 헤드라인을 가져옵니다(Google 뉴스 RSS, 키 발급 불필요).
 *
 * 🔴 제목이 보통 "기사제목 - 언론사명" 형태로 옵니다. AI 프롬프트에는 언론사명이
 * 필요 없으므로 뒤쪽 " - 언론사"를 잘라냅니다.
 *
 * AI 해석 부가 재료이므로 절대 throw하지 않고 실패 시 빈 배열을 돌려줍니다.
 *
 * 🔴 `limit` 기본값 3은 AI-1 프롬프트 재료용입니다. 공시뉴스 탭은 더 큰 값을 넘깁니다.
 */
export async function getRecentNews(query: string, limit = 3): Promise<NewsItem[]> {
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "ko");
    url.searchParams.set("gl", "KR");
    url.searchParams.set("ceid", "KR:ko");

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const items: NewsItem[] = [];
    const re =
      /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && items.length < limit) {
      const rawTitle = m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      const title = rawTitle.replace(/\s+-\s+[^-]+$/, "").trim();
      // 구글 뉴스 RSS 링크는 실제 언론사 기사가 아니라 구글 리다이렉트 URL이지만,
      // 클릭하면 그 리다이렉트를 거쳐 원문으로 이동하므로 그대로 씁니다.
      const url = m[2].trim();
      const date = formatRelativeTime(new Date(m[3]));
      if (title) items.push({ title, date, url });
    }
    return items;
  } catch {
    return [];
  }
}
