"use client";

import { useState } from "react";

type Props =
  | { target: "account" }
  | { target: "quote"; stockCode: string };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; text: string }
  | { kind: "failed" };

/**
 * AI-1 해석 영역입니다.
 *
 * 🔴 자동으로 호출하지 않습니다. Gemini 사용량이 발표 당일에 소진되면
 * 시연에서 AI가 통째로 죽으므로, 사용자가 버튼을 누를 때만 호출합니다.
 */
export function AiExplain(props: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(props),
      });
      const data = await res.json();
      if (data.ok) setState({ kind: "done", text: data.text });
      else setState({ kind: "failed" });
    } catch {
      setState({ kind: "failed" });
    }
  }

  if (state.kind === "idle") {
    return (
      <button
        onClick={run}
        className="self-start rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
      >
        이게 무슨 뜻인가요?
      </button>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-500">
        해석을 준비하고 있습니다…
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 p-3 text-sm">
        <span className="text-neutral-500">해석을 준비하지 못했습니다.</span>
        <button
          onClick={run}
          className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const sections = parseSections(state.text);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-4">
      {sections.map((s, i) => (
        <div key={i}>
          {s.label && (
            <div className="mb-0.5 text-xs font-medium text-neutral-500">
              {s.label}
            </div>
          )}
          {/*
            🔴 `break-keep`(word-break: keep-all)이 없으면 한글이 어절 중간에서
            끊깁니다. 긴 설명에서는 이것만으로도 읽는 속도가 크게 달라집니다.
          */}
          <p className="text-sm leading-7 break-keep text-neutral-700">{s.body}</p>
        </div>
      ))}
      <p className="text-xs text-neutral-400">
        AI가 숫자의 의미를 설명한 것입니다. 투자 판단은 직접 하셔야 합니다.
      </p>
    </div>
  );
}

type Section = { label: string | null; body: string };

/**
 * AI 응답을 읽기 좋은 덩어리로 자릅니다.
 *
 * 프롬프트가 `제목|내용` 형태의 줄을 요청하지만, 모델이 항상 그 형식을 지킨다고
 * 가정하지 않습니다. 형식이 어긋나면 빈 줄 기준 문단으로, 그것도 없으면
 * 통짜 한 덩어리로 떨어뜨립니다. 어느 경우에도 글이 사라지지 않습니다.
 */
function parseSections(text: string): Section[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const labeled = lines
    .map((line): Section | null => {
      const at = line.indexOf("|");
      // 제목이 문장만큼 길면 그건 제목이 아니라 본문에 섞인 세로줄입니다.
      if (at <= 0 || at > 20) return null;
      const label = line.slice(0, at).trim();
      const body = line.slice(at + 1).trim();
      return label && body ? { label, body } : null;
    })
    .filter((s) => s !== null);

  if (labeled.length >= 2) return labeled;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean);

  return paragraphs.length
    ? paragraphs.map((body) => ({ label: null, body }))
    : [{ label: null, body: text }];
}
