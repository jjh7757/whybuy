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
  hashkey?: string;
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
      ...(options.hashkey ? { hashkey: options.hashkey } : {}),
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

/** rt_cd가 아닌 필드로는 KIS 응답의 성공 여부를 알 수 없습니다. 0이 성공입니다. */
type KisResultEnvelope = {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
};

type PsblOrderResponse = KisResultEnvelope & {
  output?: { ord_psbl_cash: string };
};

/**
 * 주문가능현금을 조회합니다(가상 예산이 아니라 실제 계좌 예수금 기준, 예외 2.5용).
 *
 * 🔴 `max_buy_qty`는 증거금률(20%)이 반영돼 실제 현금보다 훨씬 큰 값이 나옵니다.
 * 예산 검증에는 반드시 `ord_psbl_cash`(주문가능현금)만 씁니다.
 */
export async function getBuyableCash(stockCode: string): Promise<number> {
  const data = (await callKis(
    "/uapi/domestic-stock/v1/trading/inquire-psbl-order",
    {
      trId: "VTTC8908R",
      query: {
        CANO: process.env.KIS_ACCOUNT_NO!,
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
        PDNO: stockCode,
        ORD_UNPR: "0",
        ORD_DVSN: "01",
        CMA_EVLU_AMT_ICLD_YN: "N",
        OVRS_ICLD_YN: "N",
      },
    },
  )) as PsblOrderResponse;

  if (data.rt_cd !== "0" || !data.output) {
    throw new Error(`매수가능조회 실패: ${data.msg1?.trim()}`);
  }
  return Number(data.output.ord_psbl_cash);
}

type OrderResponse = KisResultEnvelope & {
  output?: { ODNO: string; ORD_TMD: string };
};

/**
 * 국내주식 시장가 매수주문을 넣습니다(모의투자, 예외 2.8용).
 *
 * 🔴 hashkey를 붙인 조합으로 실주문 성공을 검증했습니다(2026-08-06 15:16 KST,
 * 주문번호 0000041001). hashkey 없이도 되는지는 확인하지 않았으므로 그대로 둡니다.
 *
 * rt_cd !== "0"이면 throw합니다. HTTP 상태는 200이라 callKis의 !res.ok 분기로는
 * 걸러지지 않고, 반드시 이 함수가 rt_cd를 직접 검사해야 합니다.
 */
export async function placeBuyOrder(
  stockCode: string,
  qty: number,
): Promise<{ orderNo: string; orderTime: string }> {
  const body = {
    CANO: process.env.KIS_ACCOUNT_NO!,
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
    PDNO: stockCode,
    ORD_DVSN: "01", // 시장가
    ORD_QTY: String(qty),
    ORD_UNPR: "0",
  };

  const hashRes = await fetch(`${BASE_URL}/uapi/hashkey`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    },
    body: JSON.stringify(body),
  });
  const hash = hashRes.ok ? ((await hashRes.json()) as { HASH?: string }).HASH : undefined;

  const data = (await callKis("/uapi/domestic-stock/v1/trading/order-cash", {
    trId: "VTTC0802U",
    method: "POST",
    body,
    hashkey: hash,
  })) as OrderResponse;

  if (data.rt_cd !== "0" || !data.output) {
    throw new Error(data.msg1?.trim() || `주문 실패 (${data.msg_cd})`);
  }

  return { orderNo: data.output.ODNO, orderTime: data.output.ORD_TMD };
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
    per: string; // 주가수익비율
    pbr: string; // 주가순자산비율
    eps: string; // 주당순이익
    bps: string; // 주당순자산
  };
};

// KIS는 지표를 못 주는 종목에도 "0.00"을 채워 보냅니다.
// 0을 그대로 표시하면 "PER 0배"라는 없는 사실이 되므로 미제공으로 취급합니다.
const ratio = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
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
    per: ratio(o.per),
    pbr: ratio(o.pbr),
    eps: ratio(o.eps),
    bps: ratio(o.bps),
  };
}

// KIS는 짧은 간격의 연속 호출을 EGW00201(초당 거래건수 초과)로 거부합니다.
// 250ms에서는 멀쩡한 종목도 실패했으므로 400ms + 실패 시 1회 재시도로 걸러냅니다.
const QUOTE_GAP_MS = 400;
const QUOTE_RETRY_BACKOFF_MS = 900;
// Vercel 함수 제한이 10초이므로 그 전에 남은 종목을 포기합니다.
const QUOTE_DEADLINE_MS = 7000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 여러 종목의 현재가를 조회합니다. 실패한 종목은 null이 됩니다.
 *
 * 🔴 레이트리밋 실패와 "존재하지 않는 종목"은 응답만으로 구분할 수 없으므로
 * 일단 재시도합니다. 재시도해도 실패할 때만 null로 확정합니다.
 * 이 구분을 하지 않으면 멀쩡한 종목이 화면에서 `—`로 보입니다.
 */
export async function getQuotes(
  codes: string[],
): Promise<{ prices: Record<string, number | null>; timedOut: boolean }> {
  const prices: Record<string, number | null> = {};
  const startedAt = Date.now();
  let timedOut = false;

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];

    if (Date.now() - startedAt > QUOTE_DEADLINE_MS) {
      prices[code] = null;
      timedOut = true;
      continue;
    }

    try {
      prices[code] = (await getQuote(code)).price;
    } catch {
      await sleep(QUOTE_RETRY_BACKOFF_MS);
      try {
        prices[code] = (await getQuote(code)).price;
      } catch {
        prices[code] = null;
      }
    }

    if (i < codes.length - 1) await sleep(QUOTE_GAP_MS);
  }

  return { prices, timedOut };
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
