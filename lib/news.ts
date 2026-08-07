import "server-only";

export type NewsItem = { title: string; date: string };

/**
 * 종목명으로 최근 뉴스 헤드라인을 가져옵니다(Google 뉴스 RSS, 키 발급 불필요).
 *
 * 🔴 제목이 보통 "기사제목 - 언론사명" 형태로 옵니다. AI 프롬프트에는 언론사명이
 * 필요 없으므로 뒤쪽 " - 언론사"를 잘라냅니다.
 *
 * AI 해석 부가 재료이므로 절대 throw하지 않고 실패 시 빈 배열을 돌려줍니다.
 */
export async function getRecentNews(query: string): Promise<NewsItem[]> {
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
    const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && items.length < 3) {
      const rawTitle = m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      const title = rawTitle.replace(/\s+-\s+[^-]+$/, "").trim();
      const date = new Date(m[2]).toLocaleDateString("ko-KR", {
        month: "long",
        day: "numeric",
      });
      if (title) items.push({ title, date });
    }
    return items;
  } catch {
    return [];
  }
}
