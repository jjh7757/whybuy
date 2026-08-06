import { NextResponse } from "next/server";
import { getAccountBalance, getQuote } from "@/lib/kis";
import { generateText, SAFETY_RULES } from "@/lib/gemini";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

async function buildAccountPrompt() {
  const b = await getAccountBalance();

  const purchaseAmount = b.holdings.reduce(
    (sum, h) => sum + h.qty * h.avgPrice,
    0,
  );
  const profitRate = purchaseAmount
    ? Number(((b.totalProfitLoss / purchaseAmount) * 100).toFixed(2))
    : 0;

  const holdings = b.holdings.length
    ? b.holdings
        .map(
          (h) =>
            `- ${h.stockName} ${h.qty}주, 평균단가 ${won(Math.round(h.avgPrice))}, 평가손익률 ${h.profitLossRate}%`,
        )
        .join("\n")
    : "- 보유 종목 없음";

  const prompt = `당신은 모의투자를 막 시작한 초보자에게 계좌 화면의 숫자를 설명하는 역할입니다.

${SAFETY_RULES}

아래는 사용자의 모의투자 계좌 상태입니다.
- 예수금: ${won(b.deposit)}
- 총평가금액: ${won(b.totalEvaluation)}
- 평가손익: ${won(b.totalProfitLoss)}
보유 종목:
${holdings}

각 숫자가 무엇을 뜻하는지 초보자가 이해할 수 있게 한국어 3~4문장으로 설명하십시오.
목록이나 제목 없이 문단 하나로만 쓰십시오.`;

  return {
    prompt,
    event: {
      name: "account_diagnosed",
      payload: {
        deposit: b.deposit,
        total_eval: b.totalEvaluation,
        profit_rate: profitRate,
      },
    },
  };
}

async function buildQuotePrompt(stockCode: string) {
  const q = await getQuote(stockCode);

  const supabase = createAdminClient();
  const { data: stock } = await supabase
    .from("stocks")
    .select("stock_name")
    .eq("stock_code", stockCode)
    .maybeSingle();

  const prompt = `당신은 모의투자를 막 시작한 초보자에게 종목 시세 화면의 숫자를 설명하는 역할입니다.

${SAFETY_RULES}

아래는 사용자가 보고 있는 종목의 시세입니다.
- 종목: ${stock?.stock_name ?? stockCode} (${stockCode})
- 현재가: ${won(q.price)}
- 전일대비: ${won(q.change)} (${q.changeRate}%)
- 시가 ${won(q.open)} / 고가 ${won(q.high)} / 저가 ${won(q.low)}
- 거래량: ${q.volume.toLocaleString("ko-KR")}주
- 업종: ${q.sector}

각 숫자가 무엇을 뜻하는지 초보자가 이해할 수 있게 한국어 3~4문장으로 설명하십시오.
이 종목을 사야 하는지 팔아야 하는지는 절대 언급하지 마십시오.
목록이나 제목 없이 문단 하나로만 쓰십시오.`;

  return { prompt, event: null };
}

export async function POST(request: Request) {
  let body: { target?: string; stockCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "잘못된 요청입니다." }, { status: 400 });
  }

  const target = body.target;
  if (target !== "account" && target !== "quote") {
    return NextResponse.json(
      { ok: false, message: "지원하지 않는 요청입니다." },
      { status: 400 },
    );
  }
  if (target === "quote" && !/^[0-9A-Z]{6}$/.test(body.stockCode ?? "")) {
    return NextResponse.json(
      { ok: false, message: "종목코드가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  // 원본 데이터 조회 실패는 AI 실패와 다릅니다. 이건 화면에 숫자조차 없다는 뜻입니다.
  let built;
  try {
    built =
      target === "account"
        ? await buildAccountPrompt()
        : await buildQuotePrompt(body.stockCode!);
  } catch (err) {
    console.error("[/api/ai/explain] 원본 데이터 조회 실패", err);
    return NextResponse.json(
      { ok: false, message: "데이터를 불러오지 못했습니다." },
      { status: 502 },
    );
  }

  const result = await generateText(built.prompt, target);

  // 🔴 AI 실패는 200으로 돌려줍니다.
  // 화면은 숫자를 그대로 유지한 채 AI 영역만 대체 문구로 바꿔야 하므로(예외 2.7),
  // 호출부가 네트워크 오류와 AI 실패를 구분할 필요가 없게 만듭니다.
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      message: "해석을 준비하지 못했습니다.",
    });
  }

  if (built.event) {
    await logEvent(built.event.name, "domain", built.event.payload);
  }

  return NextResponse.json({ ok: true, text: result.text });
}
