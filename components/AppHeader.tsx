import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";

const NAV = [
  { href: "/", label: "내 계좌" },
  { href: "/trade", label: "종목 찾아보기" },
  { href: "/journal", label: "지난 근거" },
];

/**
 * 모든 화면 위에 붙는 머리말입니다.
 *
 * 화면 사이 이동을 첫 화면의 카드 3개에만 두면, 다른 화면에 들어간 뒤에는
 * 뒤로 가기 말고는 길이 없습니다(REQ-05). 머리말에 같은 3개를 항상 둡니다.
 */
export function AppHeader({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-6 px-5 py-3 sm:px-8">
        <Link href="/" className="shrink-0 font-bold tracking-tight">
          왜샀어
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === current ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition ${
                item.href === current
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <AuthButton />
      </div>
    </header>
  );
}
