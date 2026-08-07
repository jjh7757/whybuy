"use client";

import { useCallback, useEffect, useState } from "react";

export type TutorialStep = {
  /** waitForAction 스텝은 이 id를 notify()로 받아야 다음으로 넘어갑니다. */
  id: string;
  /** data-tutorial="..." 값으로 타겟 엘리먼트를 찾습니다. */
  selector: string;
  title: string;
  body: string;
  /** true면 "다음" 버튼이 없고, notify(id)가 불릴 때까지 기다립니다. */
  waitForAction?: boolean;
};

/**
 * 튜토리얼 진행 상태만 관리합니다. 화면 그리기는 <Tutorial>이 맡습니다.
 *
 * 🔴 종목 선택 전/후로 DOM이 완전히 달라지는 화면(TradeFlow)이라, "다음" 버튼만
 * 으로는 아직 존재하지 않는 요소를 가리키게 됩니다. `waitForAction` 스텝은
 * 사용자가 실제로 그 행동을 할 때까지 멈춰 있습니다.
 */
export function useTutorial(steps: TutorialStep[], storageKey: string) {
  const [stepIndex, setStepIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      setStepIndex(0);
    }
    // 마운트 시 한 번만 확인합니다 — storageKey는 실질적으로 바뀌지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(() => {
    localStorage.setItem(storageKey, "1");
    setStepIndex(null);
  }, [storageKey]);

  const start = useCallback(() => setStepIndex(0), []);

  // 🔴 이 함수는 setStepIndex의 업데이터 함수 안에서만 호출합니다 — 업데이터
  // 안에서 다시 setState를 호출하면(예전 버전의 버그) React가 개발 모드에서
  // 업데이터를 두 번 실행할 때 스텝이 2칸씩 건너뛰는 문제가 생깁니다. 이 함수는
  // 부작용(localStorage 쓰기) 없이 순수하게 "다음 인덱스"만 계산해야 합니다.
  const computeNextIndex = useCallback(
    (i: number): number | null => {
      const nextIndex = i + 1;
      if (nextIndex >= steps.length) {
        localStorage.setItem(storageKey, "1");
        return null;
      }
      return nextIndex;
    },
    [steps.length, storageKey],
  );

  const next = useCallback(() => {
    setStepIndex((i) => (i === null ? null : computeNextIndex(i)));
  }, [computeNextIndex]);

  const notify = useCallback(
    (actionId: string) => {
      setStepIndex((i) => {
        if (i === null) return null;
        const step = steps[i];
        if (!step.waitForAction || step.id !== actionId) return i;
        return computeNextIndex(i);
      });
    },
    [steps, computeNextIndex],
  );

  return {
    active: stepIndex !== null,
    currentStep: stepIndex !== null ? steps[stepIndex] : null,
    stepIndex,
    totalSteps: steps.length,
    start,
    dismiss: finish,
    next,
    notify,
  };
}

type UseTutorialReturn = ReturnType<typeof useTutorial>;

const TOOLTIP_WIDTH = 280;
const TOOLTIP_HEIGHT_ESTIMATE = 160;
const SPOTLIGHT_PADDING = 6;
const MAX_FIND_MS = 5000; // 프레임이 아니라 실제 경과 시간 기준(고주사율 모니터에서 너무 일찍 끝나는 것을 방지)

/** 타겟 엘리먼트 주변을 어둡게 감싸고 말풍선으로 설명을 붙입니다. */
export function Tutorial({
  tutorial,
  isBlocked,
}: {
  tutorial: UseTutorialReturn;
  /** true를 반환하면 이 스텝은 아직 자동 스킵 대상이 아닙니다(예: 데이터 로딩 중) — 타임아웃 없이 계속 기다립니다. */
  isBlocked?: (step: TutorialStep) => boolean;
}) {
  const { active, currentStep, stepIndex, totalSteps, next, dismiss } = tutorial;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active || !currentStep) {
      setRect(null);
      return;
    }
    let raf = 0;
    let cancelled = false;
    let waitStartedAt: number | null = null;

    function tryFind() {
      if (cancelled) return;
      const el = document.querySelector(currentStep!.selector);
      if (el) {
        // 🔴 el.scrollIntoView()는 position:sticky인 조상(오른쪽 주문 패널)이 있으면
        // 실측 결과 스크롤이 전혀 안 움직이는 경우가 있었다(주문하기 버튼 스텝에서
        // 확인). 직접 목표 스크롤 위치를 계산해서 window.scrollTo로 옮긴다.
        const elRect = el.getBoundingClientRect();
        const targetTop =
          window.scrollY + elRect.top - (window.innerHeight / 2 - elRect.height / 2);
        window.scrollTo({ top: Math.max(0, targetTop) });
        setRect(el.getBoundingClientRect());
        return;
      }
      if (isBlocked?.(currentStep!)) {
        // 데이터 로딩/에러 등 정당한 이유로 아직 없는 경우엔 타임아웃 시계를 시작하지 않습니다.
        raf = requestAnimationFrame(tryFind);
        return;
      }
      if (waitStartedAt === null) waitStartedAt = performance.now();
      if (performance.now() - waitStartedAt > MAX_FIND_MS) {
        // 타겟을 끝내 못 찾으면(예: 화면 구조가 바뀜) 멈추지 말고 넘어갑니다.
        next();
        return;
      }
      raf = requestAnimationFrame(tryFind);
    }
    tryFind();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, currentStep, next, isBlocked]);

  useEffect(() => {
    if (!rect || !currentStep) return;
    function recompute() {
      const el = document.querySelector(currentStep!.selector);
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [rect, currentStep]);

  if (!active || !currentStep) return null;

  const spotlightStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
        borderRadius: 12,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        pointerEvents: "none",
        zIndex: 60,
      }
    : {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        pointerEvents: "none",
        zIndex: 60,
      };

  const tooltipStyle: React.CSSProperties = { position: "fixed", zIndex: 61, width: TOOLTIP_WIDTH };
  if (rect) {
    const placeBelow = rect.bottom + TOOLTIP_HEIGHT_ESTIMATE + 16 <= window.innerHeight;
    tooltipStyle.top = placeBelow
      ? rect.bottom + 12
      : Math.max(8, rect.top - TOOLTIP_HEIGHT_ESTIMATE - 12);
    tooltipStyle.left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - TOOLTIP_WIDTH - 8,
    );
  } else {
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }

  return (
    <>
      <div style={spotlightStyle} />
      <div style={tooltipStyle} className="flex flex-col gap-2 rounded-xl bg-white p-4 text-sm shadow-lg">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>
            {(stepIndex ?? 0) + 1} / {totalSteps}
          </span>
          <button type="button" onClick={dismiss} className="transition hover:text-neutral-700">
            건너뛰기
          </button>
        </div>
        <p className="font-bold">{currentStep.title}</p>
        <p className="text-neutral-600">{currentStep.body}</p>
        {!currentStep.waitForAction && (
          <button
            type="button"
            onClick={next}
            className="mt-1 self-end rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700"
          >
            {(stepIndex ?? 0) + 1 === totalSteps ? "완료" : "다음"}
          </button>
        )}
      </div>
    </>
  );
}
