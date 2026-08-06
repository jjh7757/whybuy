"use client";

import { useEffect, useState } from "react";

type Point = { date: string; close: number };

const W = 600;
const H = 140;
const PAD_Y = 8;

/**
 * 최근 3개월 종가를 선 하나로 보여줍니다.
 *
 * 캔들·이동평균선·거래량 막대를 넣지 않은 것은 의도입니다. 이 서비스의 사용자는
 * 그 기호들을 읽지 못하고, 읽는 법을 설명하는 것도 범위 밖입니다(AI-3 Should).
 * "요즘 오르는 중인지 내리는 중인지" 한 가지만 전달합니다.
 */
export function PriceChart({ stockCode }: { stockCode: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    let alive = true;
    setPoints(null);
    fetch(`/api/chart?code=${stockCode}`)
      .then((r) => r.json())
      .then((d) => alive && setPoints(d.closes ?? []))
      .catch(() => alive && setPoints([]));
    return () => {
      alive = false;
    };
  }, [stockCode]);

  if (points === null) {
    return <div className="h-[140px] animate-pulse rounded-xl bg-neutral-100" />;
  }

  // 점이 하나뿐이면 선이 그려지지 않습니다. 차트를 통째로 감춥니다.
  if (points.length < 2) return null;

  const values = points.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 한 구간에서 값이 전혀 안 움직이면 max-min이 0이 되어 0으로 나눕니다.
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD_Y + (1 - (v - min) / span) * (H - PAD_Y * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.close)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "#dc2626" : "#2563eb";
  const gradientId = `grad-${stockCode}`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[140px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`최근 ${points.length}거래일 종가 추이. 최저 ${min.toLocaleString("ko-KR")}원, 최고 ${max.toLocaleString("ko-KR")}원.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex justify-between text-xs text-neutral-400">
        <span>{formatDate(points[0].date)}</span>
        <span className="tnum">
          최근 {points.length}거래일 · {min.toLocaleString("ko-KR")}~
          {max.toLocaleString("ko-KR")}원
        </span>
        <span>{formatDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

function formatDate(yyyymmdd: string) {
  return `${Number(yyyymmdd.slice(4, 6))}.${Number(yyyymmdd.slice(6, 8))}`;
}
