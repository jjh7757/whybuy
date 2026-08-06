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
