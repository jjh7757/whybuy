import { NextResponse } from "next/server";
import { getQuote } from "@/lib/kis";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** 흐름 C: 종목 하나의 현재가를 조회합니다. */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[0-9A-Z]{6}$/.test(code)) {
    return NextResponse.json({ error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const q = await getQuote(code);
    await logEvent("quote_retrieved", "domain", {
      stock_code: q.stockCode,
      price: q.price,
      change_rate: q.changeRate,
    });
    return NextResponse.json(q);
  } catch (err) {
    console.error("[/api/quote]", err);
    return NextResponse.json(
      { error: "시세를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
