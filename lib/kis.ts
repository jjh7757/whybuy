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

// 🔴 분봉 조회(getIntradayCloses)는 한 요청 안에서 callKis를 최대 14번 부릅니다.
// 매번 Supabase에서 토큰을 다시 읽으면 페이지당 왕복 하나가 그냥 낭비되므로,
// 같은 서버리스 인스턴스가 살아있는 동안은 메모리에 들고 있다가 그것만 봅니다.
let memoryToken: { accessToken: string; expiresAt: Date } | null = null;

/** kis_tokens 캐시를 확인하고, 만료됐으면 재발급합니다. */
export async function getAccessToken(): Promise<string> {
  if (memoryToken && memoryToken.expiresAt.getTime() > Date.now()) {
    return memoryToken.accessToken;
  }

  const cached = await readCachedToken();
  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    memoryToken = { accessToken: cached.access_token, expiresAt: new Date(cached.expires_at) };
    return memoryToken.accessToken;
  }

  const { accessToken, expiresAt } = await fetchNewToken();
  await writeToken(accessToken, expiresAt);
  memoryToken = { accessToken, expiresAt };
  return accessToken;
}

/** 캐시된 토큰을 강제로 만료시킵니다. 401 응답을 받았을 때 씁니다. */
async function invalidateToken() {
  memoryToken = null;
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

// 모의투자 도메인은 앱키당 초당 1건으로 막습니다(EGW00201). 시세 조회 바로 뒤에
// 매수가능조회가 이어지는 것처럼 같은 요청 안에서도 KIS를 두 번 부르는 경로가 있어,
// 호출 사이를 실제로 띄워주는 큐가 없으면 거의 매번 걸립니다.
const KIS_MIN_INTERVAL_MS = 1100;
let kisQueue: Promise<void> = Promise.resolve();
let kisLastCallAt = 0;

function reserveKisSlot(): Promise<void> {
  const slot = kisQueue.then(async () => {
    const wait = kisLastCallAt + KIS_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    kisLastCallAt = Date.now();
  });
  kisQueue = slot.catch(() => {});
  return slot;
}

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

  await reserveKisSlot();
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
  output?: { ODNO: string; ORD_TMD: string; KRX_FWDG_ORD_ORGNO: string };
};

/**
 * 국내주식 현금 주문을 넣습니다(모의투자, 예외 2.8용). `limitPrice`가 없으면
 * 시장가, 있으면 그 가격의 지정가 주문입니다. 매수·매도는 tr_id만 다르고
 * 나머지 요청 형태(같은 엔드포인트, 같은 body, hashkey 필요)는 동일합니다.
 *
 * 🔴 hashkey를 붙인 조합으로 실주문 성공을 검증했습니다(2026-08-06 15:16 KST,
 * 매수 주문번호 0000041001). hashkey 없이도 되는지는 확인하지 않았으므로 그대로 둡니다.
 *
 * rt_cd !== "0"이면 throw합니다. HTTP 상태는 200이라 callKis의 !res.ok 분기로는
 * 걸러지지 않고, 반드시 이 함수가 rt_cd를 직접 검사해야 합니다.
 *
 * 🔴 응답의 `KRX_FWDG_ORD_ORGNO`(한국거래소전송주문조직번호)는 나중에 이 주문을
 * 취소/정정할 때 원주문번호(ODNO)와 함께 반드시 있어야 하는 값이라 같이 반환합니다.
 */
async function placeCashOrder(
  trId: string,
  stockCode: string,
  qty: number,
  limitPrice?: number,
): Promise<{ orderNo: string; orderTime: string; krxFwdgOrdOrgno: string }> {
  const body = {
    CANO: process.env.KIS_ACCOUNT_NO!,
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
    PDNO: stockCode,
    ORD_DVSN: limitPrice ? "00" : "01", // 00: 지정가, 01: 시장가
    ORD_QTY: String(qty),
    ORD_UNPR: limitPrice ? String(limitPrice) : "0",
  };

  await reserveKisSlot();
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
    trId,
    method: "POST",
    body,
    hashkey: hash,
  })) as OrderResponse;

  if (data.rt_cd !== "0" || !data.output) {
    throw new Error(data.msg1?.trim() || `주문 실패 (${data.msg_cd})`);
  }

  return {
    orderNo: data.output.ODNO,
    orderTime: data.output.ORD_TMD,
    krxFwdgOrdOrgno: data.output.KRX_FWDG_ORD_ORGNO,
  };
}

export function placeBuyOrder(stockCode: string, qty: number, limitPrice?: number) {
  return placeCashOrder("VTTC0802U", stockCode, qty, limitPrice);
}

/**
 * 국내주식 매도주문을 넣습니다(모의투자). tr_id만 매수(VTTC0802U)와 다릅니다.
 *
 * 🔴 이 서비스는 KIS 실계좌 잔고를 조회해 매도 가능 수량을 검증하지 않습니다
 * (lib/portfolio.ts 참고 — 모의계좌 1개를 여러 사용자가 나눠 쓰므로 실계좌
 * 잔고에는 다른 사용자의 보유분이 섞여 있음). 대신 이 서비스의 `orders` 테이블에
 * 기록된, 그 사용자가 이 서비스로 직접 매수해 체결된 수량만을 기준으로
 * app/api/order/route.ts에서 미리 막는다. 그래도 KIS가 실제로 거부하면(예:
 * 공유 계좌의 실제 보유수량 불일치) 그 거부는 그대로 사용자에게 전달된다.
 */
export function placeSellOrder(stockCode: string, qty: number, limitPrice?: number) {
  return placeCashOrder("VTTC0801U", stockCode, qty, limitPrice);
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
    w52_hgpr: string; // 52주 최고가
    w52_lwpr: string; // 52주 최저가
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
    week52High: ratio(o.w52_hgpr),
    week52Low: ratio(o.w52_lwpr),
  };
}

type DividendResponse = {
  output1?: Array<{
    record_date: string; // 배당기준일 (YYYYMMDD)
    sht_cd: string;
    isin_name: string;
    divi_kind: string; // 배당종류(결산/중간 등)
    per_sto_divi_amt: string; // 주당 배당금
    divi_rate: string; // 현금배당률(%)
    divi_pay_dt: string; // 배당지급일 (YYYYMMDD)
  }>;
};

export type Dividend = {
  recordDate: string;
  payDate: string;
  kind: string;
  perShare: number;
};

const kstDateString = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
};

// "YYYYMMDD"와 "YYYY/MM/DD"가 섞여 내려오므로(각각 record_date·divi_pay_dt) 화면에는
// 하나의 표기로 통일해서 보여줍니다.
const formatYmd = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
};

/**
 * 최근 2년 배당 내역을 최신순으로 반환합니다(예탁원정보 배당일정, HHKDB669102C0).
 *
 * 🔴 실측으로 확인: 연속조회 파라미터명은 문서 추정("CTS_AREA")과 달리 `CTS`다
 * (다르면 "ERROR INPUT FIELD NOT FOUND [CTS]"). 나머지 필드명은 추정이 맞았다.
 */
export async function getDividends(stockCode: string): Promise<Dividend[]> {
  const now = new Date();
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const data = (await callKis("/uapi/domestic-stock/v1/ksdinfo/dividend", {
    trId: "HHKDB669102C0",
    query: {
      CTS: "",
      GB1: "0",
      F_DT: kstDateString(twoYearsAgo),
      T_DT: kstDateString(now),
      SHT_CD: stockCode,
      HIGH_GB: "",
    },
  })) as DividendResponse;

  return (data.output1 ?? [])
    .map((r) => ({
      recordDate: formatYmd(r.record_date),
      payDate: formatYmd(r.divi_pay_dt),
      kind: r.divi_kind,
      perShare: Number(r.per_sto_divi_amt || 0),
    }))
    .filter((d) => d.perShare > 0 && d.recordDate)
    .sort((a, b) => (a.recordDate < b.recordDate ? 1 : -1));
}

type DailyCcldResponse = {
  output1?: Array<{
    odno: string; // 주문번호
    ord_qty: string; // 주문수량
    tot_ccld_qty: string; // 총체결수량
    avg_prvs: string; // 평균체결가
    rmn_qty: string; // 잔여수량
    cncl_cfrm_qty: string; // 취소확정수량
  }>;
};

export type OrderFillStatus = {
  filledQty: number;
  avgFillPrice: number;
  remainingQty: number;
  cancelledQty: number;
};

/**
 * 특정 주문의 체결 현황을 조회합니다(주식일별주문체결조회, VTTC0081R).
 *
 * 🔴 실측으로 확정: 오늘 실주문(0000005301)으로 확인 — 필드명이 문서 추정과
 * 정확히 일치했다(첫 시도에 성공). 자동 폴링은 하지 않고, 사용자가 "체결 확인"
 * 버튼을 눌렀을 때만 부른다.
 *
 * 🔴 취소해도 원주문 행의 `cncl_yn`은 그대로 "N"이다 — 취소 여부는 `cncl_cfrm_qty`
 * (취소확정수량)로 판단해야 한다. 취소는 `orgn_odno`로 원주문을 가리키는 별도의
 * 취소 거래 행으로 따로 남는다(원주문 행과 다른 `odno`).
 */
export async function checkOrderFill(orderNo: string): Promise<OrderFillStatus | null> {
  const today = kstDateString(new Date());
  const data = (await callKis("/uapi/domestic-stock/v1/trading/inquire-daily-ccld", {
    trId: "VTTC0081R",
    query: {
      CANO: process.env.KIS_ACCOUNT_NO!,
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
      INQR_STRT_DT: today,
      INQR_END_DT: today,
      SLL_BUY_DVSN_CD: "00",
      INQR_DVSN: "00",
      PDNO: "",
      CCLD_DVSN: "00",
      ORD_GNO_BRNO: "",
      ODNO: orderNo,
      INQR_DVSN_3: "00",
      INQR_DVSN_1: "",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: "",
    },
  })) as DailyCcldResponse;

  const row = (data.output1 ?? []).find((r) => r.odno === orderNo);
  if (!row) return null;

  return {
    filledQty: Number(row.tot_ccld_qty || 0),
    avgFillPrice: Math.round(Number(row.avg_prvs || 0)),
    remainingQty: Number(row.rmn_qty || 0),
    cancelledQty: Number(row.cncl_cfrm_qty || 0),
  };
}

/**
 * 국내주식 주문을 취소합니다(정정취소, VTTC0803U). 잔량 전체를 취소합니다.
 *
 * 🔴 실측으로 확인: 취소해도 원주문 행의 `cncl_yn`은 그대로 "N"이다 — 취소는
 * `orgn_odno`로 원주문을 가리키는 **별도의 취소 거래 행**으로 남고, 원주문 쪽은
 * `cncl_cfrm_qty`(취소확정수량)·`rmn_qty`(잔여수량 0)로만 취소를 알 수 있다.
 * hashkey가 필요해 `placeBuyOrder`와 같은 패턴을 그대로 쓴다.
 */
export async function cancelOrder(
  orderNo: string,
  krxFwdgOrdOrgno: string,
  remainingQty: number,
): Promise<void> {
  const body = {
    CANO: process.env.KIS_ACCOUNT_NO!,
    ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CODE!,
    KRX_FWDG_ORD_ORGNO: krxFwdgOrdOrgno,
    ORGN_ODNO: orderNo,
    ORD_DVSN: "00",
    RVSE_CNCL_DVSN_CD: "02", // 취소
    ORD_QTY: String(remainingQty),
    ORD_UNPR: "0",
    QTY_ALL_ORD_YN: "Y",
  };

  await reserveKisSlot();
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

  const data = (await callKis("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
    trId: "VTTC0803U",
    method: "POST",
    body,
    hashkey: hash,
  })) as OrderResponse;

  if (data.rt_cd !== "0") {
    throw new Error(data.msg1?.trim() || `취소 실패 (${data.msg_cd})`);
  }
}

type FinancialRatioResponse = {
  output?: Array<{
    stac_yymm: string; // 결산연월 (YYYYMM)
    grs: string; // 매출액증가율(%)
    ntin_inrt: string; // 순이익증가율(%)
    roe_val: string; // ROE(%)
    lblt_rate: string; // 부채비율(%)
  }>;
};

export type FinancialRatio = {
  period: string;
  revenueGrowth: number | null;
  netIncomeGrowth: number | null;
  roe: number | null;
  debtRatio: number | null;
};

const formatYm = (yyyymm: string) =>
  yyyymm.length === 6 ? `${yyyymm.slice(0, 4)}.${yyyymm.slice(4, 6)}` : yyyymm;

const toRatioNum = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) ? n : null;
};

/**
 * 최근 결산연도별 재무비율을 최신순으로 반환합니다(국내주식 재무비율, FHKST66430300).
 *
 * 🔴 실측으로 확인: `search-stock-info`(기업개요)와 달리 이 TR은 모의투자에서
 * 그대로 동작한다("모의투자 TR이 아닙니다" 거부 없음). 쿼리 파라미터명은 다른
 * 엔드포인트와 달리 소문자(fid_input_iscd 등)로 확인됐다.
 */
export async function getFinancialRatios(stockCode: string): Promise<FinancialRatio[]> {
  const data = (await callKis("/uapi/domestic-stock/v1/finance/financial-ratio", {
    trId: "FHKST66430300",
    query: {
      fid_input_iscd: stockCode,
      fid_div_cls_code: "0",
      fid_cond_mrkt_div_code: "J",
    },
  })) as FinancialRatioResponse;

  return (data.output ?? [])
    .filter((r) => r.stac_yymm)
    .map((r) => ({
      period: formatYm(r.stac_yymm),
      revenueGrowth: toRatioNum(r.grs),
      netIncomeGrowth: toRatioNum(r.ntin_inrt),
      roe: toRatioNum(r.roe_val),
      debtRatio: toRatioNum(r.lblt_rate),
    }))
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}

type DailyChartResponse = {
  output2?: Array<{
    stck_bsop_date: string; // 영업일자 (YYYYMMDD)
    stck_clpr: string; // 종가
  }>;
};

type ChartPoint = { label: string; close: number };

/**
 * 그래프 토글 4개는 "봉의 단위"가 아니라 **화면에 보여줄 기간**을 뜻합니다.
 * (일 = 오늘 하루, 주 = 최근 1주, 월 = 최근 3개월, 년 = 최근 1년)
 *
 * D만 완전히 다른 API(분봉)를 씁니다. 나머지는 같은 일봉 조회 API를 기간·봉
 * 단위만 바꿔 재사용합니다 — KIS가 한 번에 최대 100개까지만 주므로, "최근 1년"을
 * 일봉으로 받으면 100거래일(≈5개월)에서 끊깁니다. 그래서 1년은 주봉으로 받습니다.
 */
const RANGE_CONFIG: Record<"W" | "M" | "Y", { days: number; granularity: "D" | "W" }> = {
  W: { days: 10, granularity: "D" }, // 최근 1주 (일봉)
  M: { days: 100, granularity: "D" }, // 최근 3개월 (일봉)
  Y: { days: 370, granularity: "W" }, // 최근 1년 (주봉)
};

export type ChartRange = "D" | "W" | "M" | "Y";

export function isChartRange(v: string): v is ChartRange {
  return v === "D" || v === "W" || v === "M" || v === "Y";
}

const formatDailyLabel = (yyyymmdd: string) =>
  `${Number(yyyymmdd.slice(4, 6))}.${Number(yyyymmdd.slice(6, 8))}`;

/**
 * 구간별 종가를 오래된 것부터 반환합니다.
 *
 * 초보자에게 캔들·이동평균선은 읽을 수 없는 정보입니다. 여기서는 "요즘 오르는
 * 중인지 내리는 중인지"만 보이면 되므로 종가만 씁니다.
 */
export async function getCloses(stockCode: string, range: ChartRange): Promise<ChartPoint[]> {
  if (range === "D") return getIntradayCloses(stockCode);

  const { days, granularity } = RANGE_CONFIG[range];
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const yyyymmdd = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

  const data = (await callKis(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    {
      trId: "FHKST03010100",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: yyyymmdd(from),
        FID_INPUT_DATE_2: yyyymmdd(to),
        FID_PERIOD_DIV_CODE: granularity,
        FID_ORG_ADJ_PRC: "0",
      },
    },
  )) as DailyChartResponse;

  // KIS는 최신순으로 줍니다. 그래프는 왼쪽이 과거여야 하므로 뒤집습니다.
  // 휴장일에는 종가가 0인 행이 섞여 들어와 선이 바닥으로 꺾입니다.
  return (data.output2 ?? [])
    .map((r) => ({ date: r.stck_bsop_date, close: Number(r.stck_clpr) }))
    .filter((r) => r.close > 0)
    .reverse()
    .map((r) => ({ label: formatDailyLabel(r.date), close: r.close }));
}

type MinuteChartResponse = {
  output2?: Array<{
    stck_cntg_hour: string; // 체결시간 (HHMMSS)
    stck_prpr: string; // 체결가
  }>;
};

const MARKET_OPEN = "090000";
const MARKET_CLOSE = "153000";

// 서버가 어느 시간대에서 돌든 KST 기준 HHMMSS로 맞추기 위함입니다.
function nowKstHms(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => (parts.find((p) => p.type === type)?.value ?? "00").padStart(2, "0");
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${hour}${get("minute")}${get("second")}`;
}

// 30분 페이지를 몇 번 이어붙여야 하루(09:00~15:30, 390분)를 채우는지의 상한입니다.
// 390 ÷ 30 = 13, 여유를 하나 둡니다.
const INTRADAY_MAX_PAGES = 14;
const INTRADAY_RETRY_BACKOFF_MS = 900;
// 🔴 예전엔 여기서 7초에 끊었는데, 앱키당 초당 1건(EGW00201) 제한 때문에 페이지당
// 최소 1.1초(KIS_MIN_INTERVAL_MS)가 걸려 오후로 갈수록(페이지가 늘수록) 장 시작까지
// 못 채우고 최근 1~2시간만 남는 문제가 있었다. route.ts의 maxDuration(45초)에 맞춰
// 늘렸다 — 14페이지를 다 채워도 여유가 남는다.
const INTRADAY_DEADLINE_MS = 40_000;

async function fetchMinutePage(stockCode: string, hour: string) {
  const data = (await callKis(
    "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
    {
      trId: "FHKST03010200",
      query: {
        FID_ETC_CLS_CODE: "",
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_HOUR_1: hour,
        FID_PW_DATA_INCU_YN: "Y",
      },
    },
  )) as MinuteChartResponse;

  return (data.output2 ?? [])
    .map((r) => ({ time: r.stck_cntg_hour, close: Number(r.stck_prpr) }))
    .filter((r) => r.close > 0);
}

/**
 * 오늘 하루의 분봉을 오래된 것부터 반환합니다.
 *
 * 🔴 이 API는 한 번에 30분치만 줍니다. 하루 전체를 채우려면 장 마감(15:30)에서
 * 시작해 **뒤로** 페이지네이션합니다 — 09:00을 직접 요청하면 응답이 불안정했습니다
 * (실측: 범위가 뒤섞여 나옴). 마감 쪽에서 시작해 각 페이지의 가장 오래된 시각을
 * 다음 요청의 기준으로 삼는 방식은 4페이지 연속 검증했고 중복·공백이 없었습니다.
 *
 * 🔴 우리 쪽 시계로 "아직 개장 전"을 미리 판단하지 않습니다. 모의투자 도메인은
 * 실제 현재 시각과 무관하게 "오늘"이라는 날짜가 찍힌 하루치 분봉을 이미 들고
 * 있었습니다(실측: KST 07:27에 15:30까지의 데이터가 정상 응답). 데이터가 있는지는
 * 항상 장 마감(15:30)을 기준점으로 KIS에 직접 물어보고, 첫 페이지가 비면 그때
 * "데이터 없음"으로 판단합니다.
 *
 * 최악의 경우 13페이지가 필요한데, 실패 시 1회 재시도이므로 최대 26회 호출이
 * 될 수 있습니다. `EGW00201`(초당 거래건수 초과)에 이미 두 번 걸렸던 밤이라
 * 7초에서 남은 페이지를 포기하고 그때까지 모은 것만 보여줍니다.
 */
export async function getIntradayCloses(stockCode: string): Promise<ChartPoint[]> {
  // 장중에는 "지금"을 기준점으로 삼아야 뒤로 페이지네이션한 결과가 실제 현재
  // 시각까지 닿습니다. 항상 장 마감(15:30)에서 시작하면, 예산(7초) 안에 모을 수
  // 있는 건 장 마감 직전 몇 시간뿐이라 개장 직후(예: 09:20)엔 데이터가 전부
  // "아직 오지 않은 시각"이 되어버립니다(프런트가 지금 시각 이후를 잘라내므로).
  // 장 시작 전·마감 후에는 어차피 프런트가 화면을 비우므로 장 마감을 그대로 씁니다.
  const nowHms = nowKstHms();
  let anchor = nowHms > MARKET_OPEN && nowHms < MARKET_CLOSE ? nowHms : MARKET_CLOSE;
  const collected: { time: string; close: number }[] = [];
  const seen = new Set<string>();
  const startedAt = Date.now();

  for (let page = 0; page < INTRADAY_MAX_PAGES; page++) {
    if (Date.now() - startedAt > INTRADAY_DEADLINE_MS) break;

    let rows;
    try {
      rows = await fetchMinutePage(stockCode, anchor);
    } catch {
      await sleep(INTRADAY_RETRY_BACKOFF_MS);
      try {
        rows = await fetchMinutePage(stockCode, anchor);
      } catch {
        break; // 이 페이지는 포기하고, 지금까지 모은 것만 반환합니다.
      }
    }

    if (rows.length === 0) break;
    for (const r of rows) {
      if (!seen.has(r.time)) {
        seen.add(r.time);
        collected.push(r);
      }
    }

    const oldest = rows[rows.length - 1].time;
    if (oldest <= MARKET_OPEN) break; // 장 시작까지 다 모았습니다.

    // 가장 오래된 시각의 1분 전을 다음 페이지의 기준으로 삼습니다.
    const totalMin = Number(oldest.slice(0, 2)) * 60 + Number(oldest.slice(2, 4)) - 1;
    anchor = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}${String(totalMin % 60).padStart(2, "0")}00`;

    // 페이지 사이 간격은 reserveKisSlot()의 초당 1건 큐가 이미 보장하므로 여기서 또
    // 재우지 않습니다 — 이중으로 쉬면 그만큼 예산(INTRADAY_DEADLINE_MS)만 줄어듭니다.
  }

  return collected
    .sort((a, b) => (a.time < b.time ? -1 : 1))
    .map((r) => ({ label: `${r.time.slice(0, 2)}:${r.time.slice(2, 4)}`, close: r.close }));
}

type VolumeRankResponse = {
  output?: Array<{
    hts_kor_isnm: string; // 종목명
    mksc_shrn_iscd: string; // 종목코드
    data_rank: string; // 순위
    stck_prpr: string; // 현재가
    prdy_vrss: string; // 전일대비
    prdy_ctrt: string; // 전일대비율
    acml_vol: string; // 누적거래량
    acml_tr_pbmn: string; // 누적거래대금
  }>;
};

/**
 * 거래가 활발한 종목 순위를 한 번의 호출로 가져옵니다.
 *
 * 🔴 거래량순이 아니라 **거래대금순**(`FID_BLNG_CLS_CODE=3`)입니다. 거래량순은
 * 동전주가 상위를 채워 초보자에게 보여줄 목록이 되지 못합니다. 실제로 거래량순
 * 30건 중 `stocks` 테이블에 있는 종목은 7건뿐이었고, 거래대금순은 21건이었습니다.
 *
 * 우선주·ETF·ETN도 제외합니다(`FID_TRGT_EXLS_CLS_CODE`). 지수 추종 상품이
 * 상위를 점유하면 "지금 사람들이 보는 기업"이라는 목록의 뜻이 사라집니다.
 *
 * 🔴 시장을 전체(`0000`)가 아니라 코스피(`0001`)로 좁힙니다. `stocks` 테이블이
 * 915종목 전부 코스피라, 전체로 받으면 우리가 주문할 수 없는 코스닥 종목이
 * 30칸 중 아홉 자리를 차지합니다(실측: 전체 21건 일치 vs 코스피 29건 일치).
 */
export async function getPopularStocks() {
  const data = (await callKis("/uapi/domestic-stock/v1/quotations/volume-rank", {
    trId: "FHPST01710000",
    query: {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20171",
      FID_INPUT_ISCD: "0001", // 코스피
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: "3", // 거래금액순
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "0000101100", // 우선주·ETF·ETN 제외
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_INPUT_DATE_1: "",
    },
  })) as VolumeRankResponse;

  return (data.output ?? []).map((r) => ({
    stockCode: r.mksc_shrn_iscd,
    stockName: r.hts_kor_isnm,
    price: Number(r.stck_prpr),
    change: Number(r.prdy_vrss),
    changeRate: Number(r.prdy_ctrt),
    tradingValue: Number(r.acml_tr_pbmn), // 누적거래대금(원)
  }));
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
