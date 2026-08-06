import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import { TradeFlow } from "@/components/TradeFlow";

export default function TradePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          왜샀어 · WhyBuy
        </Link>
        <AuthButton />
      </header>

      <div>
        <h1 className="text-xl font-semibold">종목 찾아보기</h1>
        <p className="mt-1 text-sm text-neutral-500">
          시세를 확인하고 근거를 남기며 주문합니다.
        </p>
      </div>

      <TradeFlow />
    </main>
  );
}
