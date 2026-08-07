import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cancelOrder } from "@/lib/kis";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** 아직 체결 안 된 지정가 주문의 잔량을 취소합니다. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ ok: false, message: "잘못된 요청입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  // RLS의 "select own orders"가 본인 행만 돌려주므로 소유권은 자연히 걸러집니다.
  const { data: order } = await supabase
    .from("orders")
    .select("id, qty, filled_qty, order_no, krx_fwdg_ord_orgno, status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || !order.order_no || !order.krx_fwdg_ord_orgno) {
    return NextResponse.json({ ok: false, message: "주문을 찾을 수 없습니다." }, { status: 404 });
  }
  if (order.status !== "submitted") {
    return NextResponse.json(
      { ok: false, message: "취소할 수 있는 상태가 아닙니다." },
      { status: 400 },
    );
  }

  const remainingQty = order.qty - order.filled_qty;
  if (remainingQty <= 0) {
    return NextResponse.json({ ok: false, message: "취소할 잔량이 없습니다." }, { status: 400 });
  }

  try {
    await cancelOrder(order.order_no, order.krx_fwdg_ord_orgno, remainingQty);
  } catch (err) {
    console.error("[/api/order/[id]/cancel]", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, message: `취소에 실패했습니다. 사유: ${reason}` },
      { status: 502 },
    );
  }

  await supabase
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", orderId);

  await logEvent("order_cancelled", "domain", { order_id: orderId, cancelled_qty: remainingQty });

  return NextResponse.json({ ok: true });
}
