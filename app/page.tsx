import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { AccountCard } from "@/components/AccountCard";

export default function HomePage() {
  return (
    <>
      <AppHeader current="/" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8">
        <section>
          <h1 className="text-2xl font-bold leading-snug tracking-tight">
            왜 샀는지를 반드시 적게 하는
            <br />
            모의투자 도구입니다
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            로그인하면 500만원의 모의 투자금이 주어집니다. 그 한도 안에서 실제 KIS
            모의계좌에 주문을 넣어보고, 왜 샀는지를 나중에 되돌아볼 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-500">
            내 예산과 주문
          </h2>
          <AccountCard />
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <NavCard
            href="/trade"
            title="종목 찾아보기"
            desc="인기 종목을 보거나 검색해 주문합니다"
          />
          <NavCard
            href="/journal"
            title="지난 근거 보기"
            desc="쌓인 판단 근거를 되돌아봅니다"
          />
        </section>
      </main>
    </>
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
      className="flex flex-col gap-0.5 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm"
    >
      <span className="font-bold">{title}</span>
      <span className="text-sm text-neutral-500">{desc}</span>
    </Link>
  );
}
