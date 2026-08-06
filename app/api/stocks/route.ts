import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 종목명으로 검색합니다(예외 2.2 모호함·2.3 없음의 판단 근거).
 *
 * 🔴 부분 일치를 허용합니다. 사용자가 정확한 종목명을 외우고 있다고 가정하지 않습니다.
 * "삼성전자"를 검색하면 "삼성전자우"도 함께 나오고, 결과가 여러 건이면
 * 클라이언트가 후보 목록으로 보여줍니다 — 서버는 임의로 하나를 고르지 않습니다.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  // ilike 패턴의 %, _는 와일드카드로 해석되므로 검색어에 그대로 들어 있으면 이스케이프합니다.
  // 이스케이프하지 않으면 PostgREST가 패턴 자체를 거부해 502가 나거나, 의도와 다른 매칭이 됩니다.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stocks")
    .select("stock_code, stock_name, market")
    .eq("is_active", true)
    .ilike("stock_name", `%${escaped}%`)
    .order("stock_name")
    .limit(10);

  if (error) {
    console.error("[/api/stocks]", error);
    return NextResponse.json(
      { error: "종목을 검색하지 못했습니다." },
      { status: 502 },
    );
  }

  return NextResponse.json({ results: data ?? [] });
}
