import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRecentDisclosures, type Disclosure } from "@/lib/dart";
import { getRecentNews, type NewsItem } from "@/lib/news";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: stock } = await supabase
    .from("stocks")
    .select("stock_name, dart_corp_code")
    .eq("stock_code", code)
    .maybeSingle();

  // 화면 탭은 AI 프롬프트 재료(종목당 3건)보다 훨씬 많이 보여줍니다 — 사람이
  // 직접 훑어보는 목록이라 연도별로 묶어도 그럴듯한 분량이 필요합니다.
  const [disclosures, news]: [Disclosure[], NewsItem[]] = await Promise.all([
    stock?.dart_corp_code ? getRecentDisclosures(stock.dart_corp_code, 30) : Promise.resolve([]),
    stock?.stock_name ? getRecentNews(stock.stock_name, 20) : Promise.resolve([]),
  ]);

  return NextResponse.json({ disclosures, news });
}
