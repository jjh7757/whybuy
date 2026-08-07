/**
 * 판단 근거 선택지입니다. 매수·매도는 판단의 성격이 달라(손절·차익실현은
 * 매수 근거와 대응되지 않음) 목록을 따로 둡니다.
 *
 * 🔴 두 목록 모두 `gut`(그냥 감)을 반드시 남겨둡니다. 없으면 사용자가
 * 아무거나 고르고, 그러면 데이터가 오염되어 측정값을 믿을 수 없게 됩니다.
 * 정직한 선택지를 주면 `gut` 비율 자체가 지표가 됩니다.
 */
export const BUY_REASON_TYPES = [
  { value: "undervalued", label: "저평가라고 판단" },
  { value: "earnings", label: "실적이 좋아짐" },
  { value: "industry", label: "업황이 좋아 보임" },
  { value: "news", label: "뉴스나 이슈를 봄" },
  { value: "dividend", label: "배당을 기대" },
  { value: "gut", label: "그냥 감" },
] as const;

export const SELL_REASON_TYPES = [
  { value: "stop_loss", label: "손절" },
  { value: "take_profit", label: "익절" },
  { value: "target_reached", label: "목표가 도달" },
  { value: "changed_mind", label: "판단이 바뀜" },
  { value: "gut", label: "그냥 감" },
] as const;

export const REASON_TYPES = {
  buy: BUY_REASON_TYPES,
  sell: SELL_REASON_TYPES,
} as const;

export type ReasonType =
  | (typeof BUY_REASON_TYPES)[number]["value"]
  | (typeof SELL_REASON_TYPES)[number]["value"];

const LABELS = new Map<string, string>(
  [...BUY_REASON_TYPES, ...SELL_REASON_TYPES].map((r) => [r.value, r.label]),
);

export function reasonLabel(value: string | null | undefined): string {
  if (!value) return "근거 없음";
  return LABELS.get(value) ?? value;
}
