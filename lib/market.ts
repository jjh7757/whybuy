/**
 * 평일 09:00~15:30(KST)인지 확인합니다. 공휴일은 4일 프로젝트 범위 밖이라 반영하지 않습니다.
 *
 * Vercel 서버 시계는 UTC이므로 Asia/Seoul로 직접 변환해야 합니다.
 * `new Date().getHours()`를 그대로 쓰면 서버 리전에 따라 결과가 달라집니다.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday"); // "Mon".."Sun"
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutesNow = hour * 60 + minute;
  return minutesNow >= 9 * 60 && minutesNow <= 15 * 60 + 30;
}

/**
 * 한국거래소 호가단위입니다(유가증권·코스닥 공통). 가격대가 높을수록 단위가 커져서,
 * 예를 들어 20만원대 종목은 500원 단위로만 지정가를 낼 수 있습니다.
 *
 * 🔴 실측으로 확인: 이 단위를 벗어난 지정가는 KIS가 "호가단위 오류"로 거부합니다
 * (모의투자 삼성전자 235,001원 시도 → 거부, 234,500원 → 정상 접수).
 */
export function priceTickSize(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function isValidTickPrice(price: number): boolean {
  return price > 0 && price % priceTickSize(price) === 0;
}
