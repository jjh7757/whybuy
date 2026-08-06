"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; text: string }
  | { kind: "failed"; message: string };

/**
 * AI-2 회고 코멘트입니다.
 *
 * 🔴 자동으로 호출하지 않습니다. 회고 화면에 들어올 때마다 Gemini를 부르면
 * 근거 목록이 안 바뀌어도 매번 호출되어 사용량을 낭비합니다.
 */
export function JournalReview() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/ai/review", { method: "POST" });
      const data = await res.json();
      if (data.ok) setState({ kind: "done", text: data.text });
      else setState({ kind: "failed", message: data.message ?? "실패했습니다." });
    } catch {
      setState({ kind: "failed", message: "해석을 준비하지 못했습니다." });
    }
  }

  if (state.kind === "idle") {
    return (
      <button
        onClick={run}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        내 근거 되돌아보기
      </button>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-500">
        근거를 되돌아보고 있습니다…
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 p-4 text-sm">
        <span className="text-neutral-500">{state.message}</span>
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
    <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-4">
      <p className="text-sm leading-relaxed text-neutral-700">{state.text}</p>
      <p className="text-xs text-neutral-400">
        AI가 근거 목록을 되비춘 것입니다. 판단이 옳았는지는 평가하지 않습니다.
      </p>
    </div>
  );
}
