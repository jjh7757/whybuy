import { AppHeader } from "@/components/AppHeader";
import { TradeFlow } from "@/components/TradeFlow";

export default function TradePage() {
  return (
    <>
      <AppHeader current="/trade" wide />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">종목 찾아보기</h1>
          <p className="mt-1 text-sm text-neutral-500">
            시세를 확인하고 근거를 남기며 주문합니다.
          </p>
        </div>

        <TradeFlow />
      </main>
    </>
  );
}
