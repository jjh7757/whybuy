import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 화면 글자가 거의 전부 한글입니다. 라틴 폰트만 지정하면 한글은 OS 기본 폰트로
// 떨어져 기기마다 다르게 보이고, 자간·굵기도 나머지 UI와 따로 놉니다.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "왜샀어 (WhyBuy)",
  description: "왜 샀는지를 반드시 적게 하는 모의투자 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
