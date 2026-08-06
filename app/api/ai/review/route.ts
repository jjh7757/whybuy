import { NextResponse } from "next/server";
import { generateText, SAFETY_RULES } from "@/lib/gemini";
import { logEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";
import { reasonLabel } from "@/lib/rationale";

export const dynamic = "force-dynamic";

// Vercel 함수 제한(10초)과 Gemini 8초 예산 안에 들어오도록,
// 회고 코멘트는 최근 20건만 입력으로 씁니다(위험 9 대응).
const MAX_ITEMS = 20;

type Row = {
  id: number;
  stock_name: string;
  status: string;
  created_at: string;
  rationales: Array<{ reason_type: string; reason_memo: string | null }>;
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  // RLS의 "select own orders"가 본인 행만 돌려줍니다.
  const { data, error } = await supabase
    .from("orders")
    .select("id, stock_name, status, created_at, rationales(reason_type, reason_memo)")
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS);

  if (error) {
    console.error("[/api/ai/review] 근거 조회 실패", error);
    return NextResponse.json(
      { ok: false, message: "데이터를 불러오지 못했습니다." },
      { status: 502 },
    );
  }

  const rows = (data ?? []) as unknown as Row[];
  const items = rows.filter((r) => r.rationales.length > 0);

  if (items.length === 0) {
    return NextResponse.json({
      ok: false,
      message: "아직 근거를 되돌아볼 주문이 없습니다.",
    });
  }

  // 편중·기록률 계산은 코드가 직접 합니다. LLM에게 집계를 맡기면
  // 근거 6개 중 몇 건인지를 스스로 세다 틀릴 수 있고, 그러면
  // "6건 중 4건"처럼 발표에서 그대로 쓸 숫자가 부정확해집니다.
  const byType = new Map<string, number>();
  let memoFilled = 0;
  for (const r of items) {
    const rt = r.rationales[0].reason_type;
    byType.set(rt, (byType.get(rt) ?? 0) + 1);
    if (r.rationales[0].reason_memo?.trim()) memoFilled++;
  }
  const gutCount = byType.get("gut") ?? 0;
  const gutRatio = Number((gutCount / items.length).toFixed(2));

  const distribution = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${reasonLabel(type)} ${count}건`)
    .join(", ");

  const itemLines = items
    .map((r) => {
      const rt = r.rationales[0];
      const memo = rt.reason_memo?.trim() ? ` — "${rt.reason_memo.trim()}"` : "";
      const rejected = r.status === "rejected" ? " (거부됨)" : "";
      return `- ${r.stock_name}: ${reasonLabel(rt.reason_type)}${memo}${rejected}`;
    })
    .join("\n");

  const prompt = `당신은 모의투자 사용자가 최근 남긴 매수 판단 근거를 되돌아보게 돕는 역할입니다.

${SAFETY_RULES}
- 이것은 평가가 아니라 되비추기입니다. "잘했다/잘못했다"라고 말하지 마십시오.

아래는 사용자가 최근 주문 시 남긴 근거 ${items.length}건입니다(최신순).
근거 유형 분포: ${distribution}
메모를 남긴 비율: ${memoFilled}/${items.length}건

개별 내역:
${itemLines}

다음 내용을 한국어 3~4문장으로 쓰십시오.
1) 근거 유형이 한쪽으로 치우쳐 있다면 그것을 짚으십시오. 치우침이 없다면 그렇다고 말하십시오.
2) 메모가 비어 있는 근거가 있다면 언급하십시오.
3) 마지막 문장은 사용자가 스스로 생각해볼 질문 1개로 끝내십시오.
목록이나 제목 없이 문단 하나로만 쓰십시오.`;

  const result = await generateText(prompt, "review");

  // 🔴 AI 실패는 200으로 돌려줍니다. 회고 목록 자체는 이미 화면에 있으므로
  // AI 영역만 대체 문구로 바뀌어야 합니다(예외 2.7).
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      message: "해석을 준비하지 못했습니다.",
    });
  }

  await logEvent("journal_reviewed", "domain", {
    order_count: items.length,
    gut_ratio: gutRatio,
  });

  return NextResponse.json({ ok: true, text: result.text });
}
