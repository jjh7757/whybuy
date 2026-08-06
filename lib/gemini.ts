import "server-only";
import { logEvent } from "@/lib/events";

const API_KEY = process.env.GEMINI_API_KEY!;

// gemini-2.0-flash는 단종되어 404를 반환합니다.
// 2.5-flash-lite는 숫자를 다시 읽어주는 수준이고, 3.5-flash는 용어의 의미를 설명합니다.
// 지연 차이는 약 200ms이므로 8초 예산 안에서 품질을 택합니다.
const MODEL = "gemini-3.5-flash";

// Vercel 함수 제한이 10초이므로 그보다 이르게 끊습니다.
const TIMEOUT_MS = 8000;

/**
 * 🔴 모든 프롬프트에 붙는 공통 금지 규칙입니다.
 *
 * 법적으로는 특정 종목 매수 권유가 유사투자자문 영역에 접근하고,
 * 목적상으로는 AI 의견을 따라가는 순간 "사용자가 자기 판단을 설명하게 만든다"는
 * 이 서비스의 존재 이유와 정반대가 됩니다.
 */
export const SAFETY_RULES = `다음 규칙을 반드시 지키십시오.
- 특정 종목의 매수·매도를 권유하지 마십시오.
- 목표 가격이나 수익률을 예측하지 마십시오.
- 사용자의 판단이 옳거나 틀렸다고 평가하지 마십시오.
- 숫자가 무엇을 의미하는지 설명하는 데까지만 답하십시오.`;

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Gemini를 호출합니다. **절대 throw하지 않습니다.**
 *
 * AI는 부가 기능이므로 실패가 화면을 깨뜨리면 안 됩니다(예외 2.7).
 * 호출부는 ok 여부만 보고 AI 영역만 대체 문구로 바꿉니다.
 */
export async function generateText(
  prompt: string,
  purpose: string,
): Promise<GeminiResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            // 사고 과정을 끄지 않으면 짧은 답변에도 지연이 크게 늘어납니다.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await logEvent("llm_call_failed", "operation", {
        purpose,
        error: `HTTP ${res.status} ${body.slice(0, 300)}`,
      });
      return { ok: false, reason: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    if (!text) {
      await logEvent("llm_call_failed", "operation", {
        purpose,
        error: "empty response",
      });
      return { ok: false, reason: "빈 응답" };
    }

    return { ok: true, text };
  } catch (err) {
    // AbortSignal.timeout은 TimeoutError를 던집니다.
    const message = err instanceof Error ? err.message : String(err);
    await logEvent("llm_call_failed", "operation", { purpose, error: message });
    return { ok: false, reason: message };
  }
}
