import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { JournalList, type JournalRow } from "@/components/JournalList";
import { JournalReview } from "@/components/JournalReview";

export const dynamic = "force-dynamic";

type OrderRecord = {
  id: number;
  stock_code: string;
  stock_name: string;
  side: string;
  qty: number;
  expected_price: number;
  status: string;
  created_at: string;
  rationales: Array<{ reason_type: string; reason_memo: string | null }>;
};

export default async function JournalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <AppHeader current="/journal" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">지난 근거 보기</h1>
          <p className="mt-1 text-sm text-neutral-500">
            주문할 때 남긴 판단 근거를 모아 봅니다.
          </p>
        </div>

        {!user ? <LoginPrompt /> : <JournalBody />}
      </main>
    </>
  );
}

function LoginPrompt() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
      <p className="text-sm text-neutral-600">
        내 근거를 보려면 로그인이 필요합니다.
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        오른쪽 위의 [로그인] 버튼을 눌러주세요.
      </p>
    </div>
  );
}

async function JournalBody() {
  const supabase = await createClient();

  // RLS의 "select own orders" 정책이 본인 행만 돌려줍니다.
  // 애플리케이션에서 user_id를 다시 거르지 않는 이유는, 조건이 두 곳에 있으면
  // 한쪽만 고쳤을 때 조용히 어긋나기 때문입니다. 신원 판정은 DB 한 곳에서만 합니다.
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, stock_code, stock_name, side, qty, expected_price, status, created_at, rationales(reason_type, reason_memo)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
      </div>
    );
  }

  const records = (data ?? []) as unknown as OrderRecord[];

  if (records.length === 0) {
    return <EmptyState />;
  }

  const rows: JournalRow[] = records.map((o) => ({
    id: o.id,
    stockCode: o.stock_code,
    stockName: o.stock_name,
    side: o.side === "sell" ? "sell" : "buy",
    qty: o.qty,
    expectedPrice: o.expected_price,
    status: o.status,
    createdAt: o.created_at,
    reasonType: o.rationales[0]?.reason_type ?? null,
    reasonMemo: o.rationales[0]?.reason_memo ?? null,
  }));

  const total = rows.length;
  const withReason = rows.filter((r) => r.reasonType).length;
  const gut = rows.filter((r) => r.reasonType === "gut").length;

  return (
    <>
      <Summary total={total} withReason={withReason} gut={gut} />
      <JournalReview />
      <JournalList rows={rows} />
    </>
  );
}

/**
 * 🔴 비율이 아니라 실수로 표시합니다.
 * 4일치 표본은 통계가 아니므로 `100%`라고 쓰면 실제보다 과장됩니다.
 */
function Summary({
  total,
  withReason,
  gut,
}: {
  total: number;
  withReason: number;
  gut: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 rounded-xl border border-neutral-200 bg-white p-5 text-sm">
      <div>
        <div className="text-xs text-neutral-500">총 주문</div>
        <div className="tnum mt-0.5 text-lg font-bold">{total}건</div>
      </div>
      <div>
        <div className="text-xs text-neutral-500">근거 기록</div>
        <div className="tnum mt-0.5 text-lg font-bold">
          {withReason}
          <span className="text-sm font-medium text-neutral-400">/{total}건</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-neutral-500">그냥 감</div>
        <div className="tnum mt-0.5 text-lg font-bold">
          {gut}
          <span className="text-sm font-medium text-neutral-400">/{total}건</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
      <p className="text-sm text-neutral-600">아직 기록된 근거가 없습니다.</p>
      <p className="mt-1 text-sm text-neutral-500">
        종목을 주문할 때 왜 샀는지를 남기면 여기에 쌓입니다.
      </p>
      <Link
        href="/trade"
        className="mt-4 inline-block rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
      >
        종목 찾아보기
      </Link>
    </div>
  );
}
