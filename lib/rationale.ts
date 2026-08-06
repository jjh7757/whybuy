/**
 * 판단 근거 선택지 6개입니다.
 *
 * 🔴 `gut`(그냥 감)을 반드시 남겨둡니다. 없으면 사용자가 아무거나 고르고,
 * 그러면 데이터가 오염되어 측정값을 믿을 수 없게 됩니다.
 * 정직한 선택지를 주면 `gut` 비율 자체가 지표가 됩니다.
 */
export const REASON_TYPES = [
  { value: "undervalued", label: "저평가라고 판단" },
  { value: "earnings", label: "실적이 좋아짐" },
  { value: "industry", label: "업황이 좋아 보임" },
  { value: "news", label: "뉴스나 이슈를 봄" },
  { value: "dividend", label: "배당을 기대" },
  { value: "gut", label: "그냥 감" },
] as const;

export type ReasonType = (typeof REASON_TYPES)[number]["value"];

const LABELS = new Map<string, string>(
  REASON_TYPES.map((r) => [r.value, r.label]),
);

export function reasonLabel(value: string | null | undefined): string {
  if (!value) return "근거 없음";
  return LABELS.get(value) ?? value;
}
