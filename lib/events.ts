import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type EventCategory = "domain" | "operation";

/**
 * event_logs에 이벤트를 기록합니다. 실패해도 절대 throw하지 않습니다.
 * 이벤트 기록은 관찰 장치이지 업무 로직이 아니므로,
 * 여기서 실패한다고 주문 같은 본 기능이 막히면 안 됩니다.
 */
export async function logEvent(
  eventName: string,
  category: EventCategory,
  payload?: Record<string, unknown>,
  orderId?: number,
) {
  try {
    const supabase = createAdminClient();
    await supabase.from("event_logs").insert({
      event_name: eventName,
      event_category: category,
      order_id: orderId ?? null,
      payload: payload ?? null,
    });
  } catch {
    // 의도적으로 무시합니다.
  }
}
