import { NextResponse } from "next/server";
import { getQuote, getQuotes } from "@/lib/kis";
import { generateText, SAFETY_RULES } from "@/lib/gemini";
import { logEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyPortfolio } from "@/lib/portfolio";
import { getRecentDisclosures } from "@/lib/dart";
import { getRecentNews } from "@/lib/news";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

type Built = {
  prompt: string;
  event: { name: string; payload: Record<string, unknown> } | null;
};

async function buildAccountPrompt(): Promise<Built | { unauthorized: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { unauthorized: true };

  const p = await getMyPortfolio(supabase, user.id);

  let holdingsText = "- 아직 주문한 종목이 없습니다.";
  let totalEval: number | null = null;
  let profitRate = 0;

  if (p.holdings.length > 0) {
    const { prices } = await getQuotes(p.holdings.map((h) => h.stockCode));
    const lines: string[] = [];
    let evalSum = 0;
    let orderedSum = 0;

    for (const h of p.holdings) {
      const price = prices[h.stockCode] ?? null;
      if (price === null) {
        lines.push(
          `- ${h.stockName} ${h.qty}주, 주문가 ${won(Math.round(h.avgOrderPrice))}, 현재가는 조회하지 못함`,
        );
        continue;
      }
      const amount = price * h.qty;
      evalSum += amount;
      orderedSum += h.orderedAmount;
      const rate = ((amount - h.orderedAmount) / h.orderedAmount) * 100;
      lines.push(
        `- ${h.stockName} ${h.qty}주, 주문가 ${won(Math.round(h.avgOrderPrice))} → 현재가 ${won(price)} (${rate.toFixed(2)}%)`,
      );
    }

    holdingsText = lines.join("\n");
    if (orderedSum > 0) {
      totalEval = evalSum;
      profitRate = Number((((evalSum - orderedSum) / orderedSum) * 100).toFixed(2));
    }
  }

  const prompt = `당신은 모의투자를 막 시작한 초보자에게 화면의 숫자를 설명하는 역할입니다.

${SAFETY_RULES}

아래는 사용자가 이 서비스를 통해 넣은 주문과 남은 가상 예산입니다.
(공용 모의계좌 전체가 아니라 이 사용자의 몫만 담겨 있습니다.)
- 지급된 모의 투자금: ${won(p.allocated)}
- 주문에 쓴 금액: ${won(p.spent)}
- 남은 예산: ${won(p.remaining)}
보유 종목(주문 기준):
${holdingsText}

각 숫자가 무엇을 뜻하는지 초보자가 이해할 수 있게 한국어로 설명하십시오.
주문가는 시장가 주문 당시의 가격이라 실제 체결가와 다를 수 있다는 점을 한 번 언급하십시오.

🔴 출력 형식을 정확히 지키십시오. 아래 두 줄만 출력합니다.
내 예산|(지급액·사용액·남은 예산을 2문장으로)
내 주문|(보유 종목과 주문가의 의미를 2~3문장으로. 주문이 없으면 무엇을 하면 되는지 안내)

각 줄은 '제목|내용' 형태이며 제목은 위에 적힌 그대로 씁니다.
줄 안에서 줄바꿈하지 말고, 세로줄(|)은 제목 뒤 한 번만 쓰며,
번호·불릿·굵은 글씨 같은 꾸밈은 넣지 마십시오.`;

  return {
    prompt,
    // 이벤트 키는 카탈로그(account_diagnosed)를 그대로 쓰되,
    // deposit은 계좌 예수금이 아니라 이 사용자의 남은 예산을 뜻합니다.
    event: {
      name: "account_diagnosed",
      payload: {
        deposit: p.remaining,
        total_eval: totalEval,
        profit_rate: profitRate,
      },
    },
  };
}

async function buildQuotePrompt(stockCode: string): Promise<Built> {
  const supabase = createAdminClient();
  const { data: stock } = await supabase
    .from("stocks")
    .select("stock_name, dart_corp_code")
    .eq("stock_code", stockCode)
    .maybeSingle();

  // 시세(KIS)·공시(DART)·뉴스(Google) 세 소스는 서로 무관해 병렬로 받습니다.
  // 공시·뉴스는 해석 재료일 뿐이라, 둘 다 실패해도 시세만으로 해석이 나가야
  // 합니다 — 각 함수가 자체적으로 실패를 삼키고 빈 배열을 돌려줍니다.
  const [q, disclosures, news] = await Promise.all([
    getQuote(stockCode),
    stock?.dart_corp_code ? getRecentDisclosures(stock.dart_corp_code) : Promise.resolve([]),
    stock?.stock_name ? getRecentNews(stock.stock_name) : Promise.resolve([]),
  ]);

  const hasMissing = [q.per, q.pbr, q.eps, q.bps].some((v) => v === null);

  // 🔴 공시·뉴스는 "있었던 일" 재료일 뿐입니다. 매수·매도 판단으로 이어지면
  // SAFETY_RULES와 이 프로젝트의 목적(AI가 대신 판단해주지 않기)이 깨지므로,
  // 자료가 있을 때만 별도 금지 규칙과 출력 줄을 추가합니다.
  const newsMaterial = [...disclosures, ...news];
  const newsBlock =
    newsMaterial.length > 0
      ? `
최근 공시·뉴스 (사실 정보일 뿐입니다):
${disclosures.map((d) => `- [공시 ${d.date}] ${d.title}`).join("\n")}
${news.map((n) => `- [뉴스 ${n.date}] ${n.title}`).join("\n")}

🔴 위 공시·뉴스는 "이런 일이 있었다"는 사실로만 언급하십시오. 이 내용이 좋은 소식인지
나쁜 소식인지 평가하거나, 이것 때문에 사야 한다·팔아야 한다고 이어가지 마십시오.
`
      : "";

  const prompt = `당신은 모의투자를 막 시작한 초보자에게 종목 시세 화면의 숫자를 설명하는 역할입니다.

${SAFETY_RULES}

아래는 사용자가 보고 있는 종목의 시세입니다.
- 종목: ${stock?.stock_name ?? stockCode} (${stockCode})
- 현재가: ${won(q.price)}
- 전일대비: ${won(q.change)} (${q.changeRate}%)
- 시가 ${won(q.open)} / 고가 ${won(q.high)} / 저가 ${won(q.low)}
- 거래량: ${q.volume.toLocaleString("ko-KR")}주
- 업종: ${q.sector}
- PER: ${q.per === null ? "—" : `${q.per}배`}
- PBR: ${q.pbr === null ? "—" : `${q.pbr}배`}
- EPS(주당순이익): ${q.eps === null ? "—" : won(q.eps)}
- BPS(주당순자산): ${q.bps === null ? "—" : won(q.bps)}
${newsBlock}
각 숫자가 무엇을 뜻하는지 초보자가 이해할 수 있게 한국어로 설명하십시오.
PER과 PBR은 각각 무엇을 주가와 비교한 값인지 이 종목의 실제 숫자로 풀어서 알려주십시오.
🔴 지표가 높다·낮다는 사실은 말해도 되지만, 그것이 비싸다·싸다 또는 고평가·저평가라고 단정하지 마십시오.
   같은 값이라도 업종과 시점에 따라 해석이 달라진다는 점을 반드시 덧붙이십시오.
${
  q.per !== null && q.per < 0
    ? `🔴 이 종목은 순이익이 마이너스(적자)여서 PER이 음수로 나왔습니다. 화면에도 이 음수 값이 그대로 표시됩니다.
   음수 PER을 정상적인 배수처럼 설명하지 마십시오. 적자일 때는 PER 공식이 성립하지 않는다는 점과,
   마이너스라서 '낮으니 저렴하다'로 오해하면 안 된다는 점을 분명히 알려주십시오.
`
    : ""
}${
    q.pbr !== null && q.pbr < 0
      ? `🔴 이 종목은 순자산이 마이너스(자본잠식)여서 PBR도 음수입니다. 같은 방식으로 설명하십시오.
`
      : ""
  }${hasMissing ? "값이 없는 지표는 화면에 '—'로 표시되어 있습니다. 왜 비어 있을 수 있는지 짧게만 언급하십시오.\n" : "모든 지표에 값이 있으므로 값이 없는 경우를 가정해 설명하지 마십시오.\n"}이 종목을 사야 하는지 팔아야 하는지는 절대 언급하지 마십시오.

🔴 출력 형식을 정확히 지키십시오. 아래 ${newsMaterial.length > 0 ? "네" : "세"} 줄만 출력합니다.
오늘 가격|(현재가·전일대비·시가·고가·저가·거래량을 2~3문장으로)
기업 가치 지표|(PER·PBR·EPS·BPS를 2~3문장으로)
읽을 때 주의|(같은 값도 업종·시점에 따라 달라진다는 점을 1~2문장으로)${
    newsMaterial.length > 0
      ? "\n최근 소식|(위 공시·뉴스 중 있었던 사실만 2~3문장으로. 평가나 전망은 넣지 마십시오)"
      : ""
  }

각 줄은 '제목|내용' 형태이며 제목은 위에 적힌 그대로 씁니다.
줄 안에서 줄바꿈하지 말고, 세로줄(|)은 제목 뒤 한 번만 쓰며,
번호·불릿·굵은 글씨 같은 꾸밈은 넣지 마십시오.`;

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
  let built: Built;
  try {
    const result =
      target === "account"
        ? await buildAccountPrompt()
        : await buildQuotePrompt(body.stockCode!);

    if ("unauthorized" in result) {
      return NextResponse.json(
        { ok: false, message: "로그인이 필요합니다." },
        { status: 401 },
      );
    }
    built = result;
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
