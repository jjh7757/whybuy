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

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3">
      <p className="text-sm leading-relaxed text-neutral-700">{state.text}</p>
      <p className="text-xs text-neutral-400">
        AI가 숫자의 의미를 설명한 것입니다. 투자 판단은 직접 하셔야 합니다.
      </p>
    </div>
  );
}
