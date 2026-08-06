import { NextResponse } from "next/server";
import { getAccountBalance } from "@/lib/kis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const balance = await getAccountBalance();
    return NextResponse.json(balance);
  } catch (err) {
    console.error("[/api/account]", err);
    return NextResponse.json(
      { error: "계좌 정보를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
