"use client";

import { useEffect, useRef, useState } from "react";

type Point = { label: string; close: number };
type Range = "D" | "W" | "M" | "Y";

const RANGES: { value: Range; label: string }[] = [
  { value: "D", label: "일" },
  { value: "W", label: "주" },
  { value: "M", label: "월" },
  { value: "Y", label: "년" },
];

// 버튼은 "보여줄 기간"이고, 그 기간을 실제로 채우는 봉의 단위는 구간마다 다릅니다.
// (일=분봉, 주·월=일봉, 년=주봉 — lib/kis.ts의 RANGE_CONFIG와 짝을 맞춥니다)
const RANGE_TEXT: Record<Range, { window: string; unit: string }> = {
  D: { window: "오늘", unit: "분" },
  W: { window: "최근 1주", unit: "거래일" },
  M: { window: "최근 3개월", unit: "거래일" },
  Y: { window: "최근 1년", unit: "주" },
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

const W = 600;
const H = 140;
const PAD_Y = 8;

const MARKET_OPEN_MIN = 9 * 60;
const MARKET_CLOSE_MIN = 15 * 60 + 30;
const MARKET_MINUTES = MARKET_CLOSE_MIN - MARKET_OPEN_MIN;

function labelToMinutes(label: string): number {
  const [h, m] = label.split(":").map(Number);
  return h * 60 + m;
}

// 모의투자 도메인은 실제 시각과 무관하게 하루치(09:00~15:30) 분봉을 통째로 내려줍니다.
// 지금 몇 분이 지났는지는 서버가 아니라 브라우저 시계로 판단해야 "지금까지"만 그려집니다.
function nowKstMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * 종가를 선 하나로 보여줍니다. 일·주·월·년 구간을 토글합니다.
 *
 * 캔들·이동평균선·거래량 막대를 넣지 않은 것은 의도입니다. 이 서비스의 사용자는
 * 그 기호들을 읽지 못하고, 읽는 법을 설명하는 것도 범위 밖입니다(AI-3 Should).
 * "요즘 오르는 중인지 내리는 중인지" 한 가지만 전달합니다.
 */
export function PriceChart({ stockCode }: { stockCode: string }) {
  const [range, setRange] = useState<Range>("D");
  const [points, setPoints] = useState<Point[] | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    setPoints(null);
    setHoverIndex(null);
    fetch(`/api/chart?code=${stockCode}&period=${range}`)
      .then((r) => r.json())
      .then((d) => alive && setPoints(d.closes ?? []))
      .catch(() => alive && setPoints([]));
    return () => {
      alive = false;
    };
    // 종목을 바꿀 때뿐 아니라 구간을 바꿀 때도 다시 받아야 합니다.
  }, [stockCode, range]);

  // 포인터 x좌표를 그 위치에 가장 가까운 데이터 인덱스로 바꿉니다.
  // 뷰박스(600) 기준이 아니라 SVG가 실제로 그려진 화면 폭을 기준으로 계산해야
  // 화면 크기·레이아웃이 달라져도 짚은 위치와 표시되는 값이 어긋나지 않습니다.
  //
  // "일" 구간은 지금까지 흐른 시간만큼만 폭을 채우고 나머지는 비워두므로
  // (등분이 아니라 시간 비례 배치), 화면 폭 비율을 봉 개수가 아니라 실제
  // 하루 시간으로 환산해 가장 가까운 봉을 찾아야 빈 공간에서 커서가 엉뚱한
  // 봉을 가리키지 않습니다.
  function updateHoverFromClientX(clientX: number, data: Point[]) {
    const svg = svgRef.current;
    if (!svg || data.length < 2) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

    if (range === "D") {
      const targetMin = MARKET_OPEN_MIN + ratio * MARKET_MINUTES;
      let nearest = 0;
      let nearestDist = Infinity;
      data.forEach((p, i) => {
        const dist = Math.abs(labelToMinutes(p.label) - targetMin);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      });
      setHoverIndex(nearest);
    } else {
      setHoverIndex(Math.round(ratio * (data.length - 1)));
    }
  }

  const toggle = (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => setRange(r.value)}
          aria-pressed={range === r.value}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
            range === r.value
              ? "bg-neutral-900 text-white"
              : "text-neutral-400 hover:bg-neutral-100"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  if (points === null) {
    return (
      <div>
        <div className="mb-1 flex justify-end">{toggle}</div>
        {/* 🔴 "일" 구간은 KIS 분봉을 여러 페이지 이어붙이느라 오래(수십 초까지) 걸릴 수
            있어서, 그냥 회색 박스만 두면 멈춘 것처럼 보인다. 스피너로 계속 움직이고
            있음을 보여준다. */}
        <div className="flex h-[140px] flex-col items-center justify-center gap-2 rounded-xl bg-neutral-100 text-xs text-neutral-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500" />
          차트를 불러오는 중...
        </div>
      </div>
    );
  }

  // "일" 구간은 KIS 모의투자가 09:00~15:30 하루치를 통째로 내려주므로, 지금
  // 시각(KST) 이후 데이터는 잘라냅니다. 실제 시세 앱처럼 지금까지 흐른 만큼만
  // 그리고 나머지는 빈 채로 남겨두기 위함입니다. 다른 구간(주·월·년)은 봉이
  // 항상 이미 확정된 과거 값이라 자를 필요가 없습니다.
  const shown =
    range === "D"
      ? points.filter(
          (p) => labelToMinutes(p.label) <= Math.min(nowKstMinutes(), MARKET_CLOSE_MIN),
        )
      : points;

  // 점이 하나뿐이면 선이 그려지지 않습니다. 그래프 자리만 비우고 토글은 남깁니다
  // — 구간을 바꿔서 다시 시도할 길을 없애면 안 됩니다.
  if (shown.length < 2) {
    return (
      <div>
        <div className="mb-1 flex justify-end">{toggle}</div>
        <p className="py-8 text-center text-sm text-neutral-400">
          {range === "D"
            ? "장이 열리면 오늘의 그래프가 보입니다."
            : "이 구간은 보여줄 데이터가 없습니다."}
        </p>
      </div>
    );
  }

  const values = shown.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 한 구간에서 값이 전혀 안 움직이면 max-min이 0이 되어 0으로 나눕니다.
  const span = max - min || 1;

  // "일"은 하루 중 흐른 시간 비율로 x를 정해 지금 시각까지만 폭을 채우고,
  // 나머지 구간은 봉 개수를 그대로 등분합니다(이미 하루치가 다 확정돼 있으므로).
  const x =
    range === "D"
      ? (i: number) => ((labelToMinutes(shown[i].label) - MARKET_OPEN_MIN) / MARKET_MINUTES) * W
      : (i: number) => (i / (shown.length - 1)) * W;
  const y = (v: number) => PAD_Y + (1 - (v - min) / span) * (H - PAD_Y * 2);

  const line = shown.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.close)}`).join(" ");
  const area = `${line} L${x(shown.length - 1)},${H} L${x(0)},${H} Z`;

  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "#dc2626" : "#2563eb";
  const gradientId = `grad-${stockCode}-${range}`;
  const { window: rangeWindow, unit } = RANGE_TEXT[range];

  const hoverPoint = hoverIndex !== null ? shown[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? x(hoverIndex) : 0;
  const hoverY = hoverPoint ? y(hoverPoint.close) : 0;
  // 툴팁이 SVG의 좌우 끝을 넘어가면 잘려 보이므로 8~92% 안으로 눌러둡니다.
  // 인덱스가 아니라 실제 x좌표 비율로 계산해야 "일" 구간(시간 비례 배치)에서도 어긋나지 않습니다.
  const hoverPct = hoverIndex !== null ? Math.min(92, Math.max(8, (hoverX / W) * 100)) : 0;

  return (
    <div>
      <div className="mb-1 flex justify-end">{toggle}</div>

      <div className="relative">
        {hoverPoint && (
          <div
            className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5"
            style={{ left: `${hoverPct}%` }}
          >
            <span className="tnum whitespace-nowrap rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] text-white">
              {hoverPoint.label}
            </span>
            <span className="tnum whitespace-nowrap text-sm font-bold">
              {won(hoverPoint.close)}
            </span>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-[140px] w-full touch-none"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${rangeWindow} 종가 추이. 최저 ${min.toLocaleString("ko-KR")}원, 최고 ${max.toLocaleString("ko-KR")}원.`}
          onPointerDown={(e) => {
            // 포인터 캡처가 실패해도(구형 브라우저 등) 첫 터치 위치 표시는 되어야 합니다.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // 캡처 없이도 이후 pointermove는 독립적으로 계속 들어옵니다.
            }
            updateHoverFromClientX(e.clientX, shown);
          }}
          onPointerMove={(e) => updateHoverFromClientX(e.clientX, shown)}
          onPointerUp={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerLeave={() => setHoverIndex(null)}
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

          {hoverPoint && (
            <>
              <line
                x1={hoverX}
                y1={0}
                x2={hoverX}
                y2={H}
                stroke="#9ca3af"
                strokeWidth="1"
                strokeDasharray="4,3"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r="4"
                fill={stroke}
                stroke="white"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-xs text-neutral-400">
        <span>{shown[0].label}</span>
        <span className="tnum">
          {rangeWindow} · {shown.length}
          {unit} · {min.toLocaleString("ko-KR")}~{max.toLocaleString("ko-KR")}원
        </span>
        <span>{shown[shown.length - 1].label}</span>
      </div>
    </div>
  );
}
