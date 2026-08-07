import "server-only";

const API_KEY = process.env.DART_API_KEY!;

export type Disclosure = { title: string; date: string };

type DartListResponse = {
  status: string;
  message: string;
  list?: Array<{ report_nm: string; rcept_dt: string }>;
};

const formatDate = (yyyymmdd: string) =>
  `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}`;

/**
 * 최근 공시를 최신순으로 반환합니다(공시검색 API, `pblntf_ty=I` 거래소공시).
 *
 * 🔴 필터 없이 전체 공시를 받으면 "임원ㆍ주요주주특정증권등소유상황보고서"(지분
 * 변동) 같은 일상적인 신고가 대부분을 차지해 AI 해석 재료로는 잡음입니다.
 * 거래소공시(I)로 좁히면 실적·배당·자사주 같은 실제로 "있었던 일"만 남습니다.
 *
 * AI 해석은 부가 기능이므로(예외 2.7과 같은 원칙) 절대 throw하지 않고 실패 시
 * 빈 배열을 돌려줍니다 — 공시를 못 가져와도 시세·주문은 그대로 동작해야 합니다.
 */
export async function getRecentDisclosures(corpCode: string): Promise<Disclosure[]> {
  try {
    const today = new Date();
    const from = new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000);
    const yyyymmdd = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

    const url = new URL("https://opendart.fss.or.kr/api/list.json");
    url.searchParams.set("crtfc_key", API_KEY);
    url.searchParams.set("corp_code", corpCode);
    url.searchParams.set("bgn_de", yyyymmdd(from));
    url.searchParams.set("end_de", yyyymmdd(today));
    url.searchParams.set("pblntf_ty", "I");
    url.searchParams.set("page_count", "3");

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];

    const data = (await res.json()) as DartListResponse;
    // status "013"은 "조회된 데이터가 없습니다" — 에러가 아니라 그냥 공시가 없는 것입니다.
    if (data.status !== "000" || !data.list) return [];

    return data.list.map((d) => ({
      title: d.report_nm.trim(),
      date: formatDate(d.rcept_dt),
    }));
  } catch {
    return [];
  }
}
