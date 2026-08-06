import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import { AccountCard } from "@/components/AccountCard";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold">왜샀어 · WhyBuy</span>
        <AuthButton />
      </header>

      <section className="rounded-xl border border-neutral-200 p-6">
        <p className="text-base leading-relaxed">
          이 서비스는 <strong>왜 샀는지를 반드시 적게 하는 모의투자 도구</strong>
          입니다. Google로 로그인하면 500만원의 모의 투자금이 주어지고, 그
          한도 안에서 실제 KIS 모의계좌에 주문을 넣어볼 수 있습니다.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          내 예산과 주문
        </h2>
        <AccountCard />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <NavCard
          href="/"
          title="내 계좌 보기"
          desc="예수금·보유종목을 확인하고 AI 해석을 받습니다"
        />
        <NavCard
          href="/trade"
          title="종목 찾아보기"
          desc="시세를 확인하고 근거를 남기며 주문합니다"
        />
        <NavCard
          href="/journal"
          title="지난 근거 보기"
          desc="쌓인 판단 근거를 되돌아봅니다"
        />
      </section>
    </main>
  );
}

function NavCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 hover:shadow-sm"
    >
      <span className="font-medium">{title}</span>
      <span className="text-sm text-neutral-500">{desc}</span>
    </Link>
  );
}
