import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

const BASE_URL = process.env.KIS_BASE_URL!;
const APP_KEY = process.env.KIS_APP_KEY!;
const APP_SECRET = process.env.KIS_APP_SECRET!;

const TOKEN_EARLY_EXPIRY_MS = 10 * 60 * 1000; // 만료 10분 전에 미리 갱신

async function fetchNewToken(): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    await logEvent("token_refresh_failed", "operation", {
      status: res.status,
      body: body.slice(0, 500),
    });
    throw new Error(`KIS 토큰 발급 실패 (${res.status})`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number; // 초 단위, 보통 86400
  };

  const expiresAt = new Date(
    Date.now() + data.expires_in * 1000 - TOKEN_EARLY_EXPIRY_MS,
  );

  return { accessToken: data.access_token, expiresAt };
}

async function readCachedToken() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("kis_tokens")
    .select("access_token, expires_at")
    .eq("id", 1)
    .maybeSingle();
  return data;
}

async function writeToken(accessToken: string, expiresAt: Date) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("kis_tokens").upsert({
    id: 1,
    access_token: accessToken,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  await logEvent("token_refreshed", "operation", {
    expires_at: expiresAt.toISOString(),
  });
}

/** kis_tokens 캐시를 확인하고, 만료됐으면 재발급합니다. */
export async function getAccessToken(): Promise<string> {
  const cached = await readCachedToken();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return cached.access_token;
  }

  const { accessToken, expiresAt } = await fetchNewToken();
  await writeToken(accessToken, expiresAt);
  return accessToken;
}

/** 캐시된 토큰을 강제로 만료시킵니다. 401 응답을 받았을 때 씁니다. */
async function invalidateToken() {
  const supabase = createAdminClient();
  await supabase
    .from("kis_tokens")
    .update({ expires_at: new Date(0).toISOString() })
    .eq("id", 1);
}

type KisCallOptions = {
  trId: string;
  query?: Record<string, string>;
  method?: "GET" | "POST";
  body?: unknown;
};

/**
 * KIS API를 호출합니다. 401(인증 만료)이면 토큰을 무효화하고 딱 1회만 재시도합니다.
 * 서버리스에서 재시도 루프는 요청 폭주가 되므로 2회 이상 시도하지 않습니다.
 */
export async function callKis(
  path: string,
  options: KisCallOptions,
  _retried = false,
): Promise<unknown> {
  const token = await getAccessToken();
  const url = new URL(path, BASE_URL);
  if (options.query) {
    Object.entries(options.query).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: options.trId,
      custtype: "P",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !_retried) {
    await invalidateToken();
    return callKis(path, options, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`KIS 호출 실패 (${res.status}): ${body.slice(0, 300)}`);
  }

  return res.json();
}

type QuoteResponse = {
  output: {
    stck_prpr: string; // 현재가
    prdy_vrss: string; // 전일대비
    prdy_ctrt: string; // 전일대비율
    stck_oprc: string; // 시가
    stck_hgpr: string; // 고가
    stck_lwpr: string; // 저가
    acml_vol: string; // 누적거래량
    bstp_kor_isnm: string; // 업종명
    rprs_mrkt_kor_name: string; // 대표시장명
  };
};

/**
 * 종목 현재가를 조회합니다. 휴장일에는 전일 종가가 응답됩니다.
 *
 * 존재하지 않는 종목코드도 rt_cd=0으로 응답하되 현재가가 0이므로,
 * 값이 0이면 조회 실패로 봅니다.
 */
export async function getQuote(stockCode: string) {
  const data = (await callKis(
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    {
      trId: "FHKST01010100",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: stockCode,
      },
    },
  )) as QuoteResponse;

  const o = data.output;
  const price = Number(o?.stck_prpr ?? 0);
  if (!price) throw new Error(`시세를 조회하지 못했습니다 (${stockCode})`);

  return {
    stockCode,
    price,
    change: Number(o.prdy_vrss),
    changeRate: Number(o.prdy_ctrt),
    open: Number(o.stck_oprc),
    high: Number(o.stck_hgpr),
    low: Number(o.stck_lwpr),
    volume: Number(o.acml_vol),
    sector: o.bstp_kor_isnm,
    market: o.rprs_mrkt_kor_name,
  };
}

type BalanceResponse = {
  output1: Array<{
    pdno: string; // 종목코드
    prdt_name: string; // 종목명
    hldg_qty: string; // 보유수량
    pchs_avg_pric: string; // 매입평균가
    evlu_amt: string; // 평가금액
    evlu_pfls_amt: string; // 평가손익금액
    evlu_pfls_rt: string; // 평가손익률
  }>;
  output2: Array<{
    dnca_tot_amt: string; // 예수금총금액
    tot_evlu_amt: string; // 총평가금액
    evlu_pfls_smtl_amt: string; // 평가손익합계금액
  }>;
};

/** 모의계좌 잔고를 조회합니다. */
export async function getAccountBalance() {
  const data = (await callKis("/uapi/domestic-stock/v1/trading/inquire-balance", {
    trId: "VTTC8434R", // 모의투자 잔고조회. 실전이면 TTTC8434R
    query: {
      CANO: process.env.KIS_ACCOUNT_NO!,
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
      AFHR_FLPR_YN: "N",
      OFL_YN: "",
      INQR_DVSN: "02",
      UNPR_DVSN: "01",
      FUND_STTL_ICLD_YN: "N",
      FNCG_AMT_AUTO_RDPT_YN: "N",
      PRCS_DVSN: "01",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: "",
    },
  })) as BalanceResponse;

  const summary = data.output2[0];

  return {
    deposit: Number(summary.dnca_tot_amt),
    totalEvaluation: Number(summary.tot_evlu_amt),
    totalProfitLoss: Number(summary.evlu_pfls_smtl_amt),
    holdings: data.output1
      .filter((h) => Number(h.hldg_qty) > 0)
      .map((h) => ({
        stockCode: h.pdno,
        stockName: h.prdt_name,
        qty: Number(h.hldg_qty),
        avgPrice: Number(h.pchs_avg_pric),
        evalAmount: Number(h.evlu_amt),
        profitLoss: Number(h.evlu_pfls_amt),
        profitLossRate: Number(h.evlu_pfls_rt),
      })),
  };
}
