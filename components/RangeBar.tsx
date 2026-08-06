const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/**
 * 최저~최고 구간에서 현재가가 어디쯤인지 점으로 표시합니다.
 *
 * "52주 최고 374,500원"이라는 숫자만으로는 지금 가격이 높은 편인지 낮은 편인지
 * 초보자가 계산해야 합니다. 위치로 보여주면 계산이 필요 없습니다.
 */
export function RangeBar({
  label,
  low,
  high,
  current,
}: {
  label: string;
  low: number;
  high: number;
  current: number;
}) {
  // 상·하한이 같으면(거래 없는 날 등) 0으로 나눕니다. 가운데로 둡니다.
  const ratio = high === low ? 0.5 : (current - low) / (high - low);
  const pct = Math.min(100, Math.max(0, ratio * 100));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className="tnum text-neutral-400">
          {won(low)} ~ {won(high)}
        </span>
      </div>
      <div
        className="relative h-1.5 rounded-full bg-neutral-200"
        role="img"
        aria-label={`${label} ${won(low)}부터 ${won(high)} 사이에서 현재 ${won(current)}`}
      >
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-900 shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
