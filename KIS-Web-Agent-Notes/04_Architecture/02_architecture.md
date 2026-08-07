# 아키텍처

- 작성일: 2026-08-06
- **갱신일: 2026-08-07** — 실제 구현과 대조해 전면 수정했습니다.

> 🔄 **계획 시점의 구조와 실제 코드를 함께 담습니다.** 원래 그림을 지우지 않는 이유는
> [[01_data_flow|데이터 흐름]]·[[../07_Submit/02_scope_reduction|범위 축소 설명서]]와 같습니다.
> 계획이 뒤집힌 자리는 `~~취소선~~` + 🔄 로 남기고 왜 바뀌었는지를 적었습니다.
>
> ⚠️ **가장 크게 틀렸던 곳**: 5절 `/api/order` 검증 순서(7번·8번이 실제와 정반대)와,
> 이 문서 전체에 **KIS 레이트리밋(EGW00201) 대응이 한 줄도 없다는 것**입니다. 4b절을 신설했습니다.

---

## 1. 전체 구성

```
[사용자] ── 브라우저
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Next.js (App Router) — Vercel 배포 (리전 icn1)      │
│                                                     │
│  화면 (Server / Client Component)                    │
│    /            계좌 대시보드                         │
│    /trade       종목 조회 + 주문 (탭 3개)              │
│    /journal     근거 회고                            │
│    /auth/error  로그인 실패 안내                   🆕 │
│                                                     │
│  서버 로직 (Route Handler) — 🔄 6개가 아니라 15개      │
│    조회   /api/account   /api/budget         🆕      │
│           /api/quote     /api/quotes         🆕      │
│           /api/stocks    /api/popular        🆕      │
│           /api/chart     /api/dividend       🆕      │
│           /api/financial-ratio               🆕      │
│           /api/disclosures                   🆕      │
│    주문   /api/order                  🔴 핵심         │
│           /api/order/[id]/check-fill         🆕      │
│           /api/order/[id]/cancel             🆕      │
│    AI     /api/ai/explain  /api/ai/review           │
│                                                     │
│  그 밖   /auth/callback (Google OAuth 콜백)          │
│         proxy.ts (세션 쿠키 갱신 미들웨어)      🆕     │
└─────────────────────────────────────────────────────┘
      │            │              │            │
      │            │              │            └──> ┌──────────────┐
      │            │              │                 │ DART 공시    │🆕
      │            │              │                 │ 구글 뉴스 RSS│🆕
      │            │              ▼                 └──────────────┘
      │            │        ┌───────────┐
      │            │        │  KIS API  │ 모의투자
      │            │        └───────────┘
      │            ▼
      │      ┌───────────┐
      │      │ Gemini API│
      │      └───────────┘
      ▼
┌──────────────────────────────┐
│           Supabase           │
│  stocks / orders /           │
│  rationales / user_wallets 🆕│
│  kis_tokens / event_logs     │
└──────────────────────────────┘
```

요청서의 시스템 구성도와 동일한 구조이고, KIS API가 하나 더 붙었습니다.

### 🔄 계획 대비 늘어난 것

| | 계획 | 실제 | 늘어난 이유 |
|---|---:|---:|---|
| Route Handler | ~~6개~~ | **15개** | 아래 표 |
| 외부 API | ~~2개~~ (KIS·Gemini) | **4개** (+ DART, 구글 뉴스 RSS) | [[../05_Scope/01_mvp_scope\|MVP 범위]] 4.2f·4.2g절 |
| Supabase 테이블 | ~~5개~~ | **6개** | `user_wallets`가 목록에서 빠져 있었습니다. Must 8번(가상 예산)에 처음부터 있던 테이블이라 **단순 누락**입니다 |

| 🆕 늘어난 라우트 | 무엇을 하는가 | 왜 생겼나 |
|---|---|---|
| `/api/budget` | 남은 가상 예산 + 매도 가능 수량 (KIS 안 부름) | `/api/account`는 보유 종목 수만큼 KIS를 부릅니다. 주문 화면이 "얼마까지 살 수 있나" 한 줄 때문에 그 비용을 치르면 EGW00201에 걸립니다 |
| `/api/popular` | 코스피 거래대금 순위 | 검색창만 두면 종목명을 아는 사람만 쓸 수 있음 (REQ-05) — 4.2b절 |
| `/api/chart` | 기간별 종가 (일=분봉) | 4.2b절 |
| `/api/quotes` | 여러 종목 현재가 일괄 | 회고 화면이 클라이언트에서 현재가를 얹기 위함 — [[01_data_flow\|데이터 흐름]] 4절 |
| `/api/dividend` | 최근 배당 이력 | 4.2c절 |
| `/api/financial-ratio` | 부채비율·ROE·성장률 | 4.2c절 |
| `/api/disclosures` | DART 공시 + 뉴스 헤드라인 | 4.2g절 |
| `/api/order/[id]/check-fill` | 지정가 주문 체결 조회 | 지정가 도입의 **전제 조건** — 4.2c절 |
| `/api/order/[id]/cancel` | 지정가 주문 취소 | 위와 같음 |

---

## 2. 🔴 절대 규칙 — 외부 API는 서버에서만 호출합니다

```
브라우저 ──❌──> KIS API      (앱키가 노출됩니다)
브라우저 ──❌──> Gemini API   (API 키가 노출됩니다)
브라우저 ──❌──> DART API     (인증키가 노출됩니다)        🆕
브라우저 ──✅──> /api/*  ──> KIS / Gemini / DART / 뉴스
```

### 판별 기준

| 이 값을 쓰는 코드는 | 어디에 있어야 하는가 |
|---|---|
| `KIS_APP_KEY` / `KIS_APP_SECRET` / `KIS_BASE_URL` | `app/api/**` 또는 `lib/**` (서버 전용) |
| `KIS_ACCOUNT_NO` / `KIS_ACCOUNT_PRODUCT_CODE` | 동일 |
| `GEMINI_API_KEY` | 동일 |
| 🆕 `DART_API_KEY` | 동일 (`lib/dart.ts`) |
| `SUPABASE_SERVICE_ROLE_KEY` | 동일 (`lib/supabase/admin.ts`) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 어디든 (공개 전제) |
| Google OAuth 클라이언트 시크릿 | Supabase 대시보드에만 등록 (앱 코드에는 없음) |

> `user_id`는 쿠키가 아니라 **Supabase Auth 세션**에서 나옵니다. `auth.getUser()`가 서버에서 세션 쿠키를 검증해 실제 로그인된 사용자의 UUID를 돌려줍니다. 클라이언트가 값을 조작할 수 없습니다.

> 🔴 **`'use client'`가 붙은 파일에서 위 값들을 import하면 안 됩니다.** Next.js는 서버 전용 환경변수를 클라이언트에서 읽으면 `undefined`를 주므로 조용히 실패합니다. 배포 후에야 드러납니다.
>
> 🆕 **코드로 강제했습니다.** `lib/kis.ts`·`lib/gemini.ts`·`lib/dart.ts`·`lib/news.ts`·`lib/events.ts`·`lib/portfolio.ts` 맨 위에 `import "server-only"`가 있어, 클라이언트 번들에 섞이면 **빌드가 실패합니다.** 규칙을 문서로만 두지 않았습니다.

---

## 3. 레이어 구성

```
app/
  page.tsx                    계좌 대시보드
  layout.tsx  globals.css
  trade/page.tsx              종목 조회 + 주문
  journal/page.tsx            근거 회고
  auth/callback/route.ts      Google OAuth 콜백
  auth/error/page.tsx         🆕 로그인 실패 안내
  api/
    account/route.ts            budget/route.ts            🆕
    quote/route.ts              quotes/route.ts            🆕
    stocks/route.ts             popular/route.ts           🆕
    chart/route.ts            🆕 dividend/route.ts         🆕
    financial-ratio/route.ts  🆕 disclosures/route.ts      🆕
    order/route.ts            🔴 핵심
    order/[id]/check-fill/route.ts  🆕
    order/[id]/cancel/route.ts      🆕
    ai/explain/route.ts         ai/review/route.ts
proxy.ts                      🆕 세션 쿠키 갱신 (Next 16 미들웨어 규약)
vercel.json                   🆕 리전 고정 (8절)
lib/
  kis.ts                  KIS 호출 + 토큰 캐시 + 🆕 전역 큐
  gemini.ts               Gemini 호출 + 프롬프트 공통 규칙
  supabase/server.ts      🔄 서버(세션) 클라이언트
  supabase/client.ts      🔄 브라우저 클라이언트
  supabase/admin.ts       🔄 service role 클라이언트
  events.ts               이벤트 기록
  market.ts               장 운영시간 판정 + 🆕 호가단위
  portfolio.ts            🆕 보유수량·가상예산·매도가능수량 계산
  rationale.ts            🆕 근거 유형 목록 (매수 6종 / 매도 5종)
  dart.ts                 🆕 DART 공시 조회
  news.ts                 🆕 구글 뉴스 RSS
components/               🆕 14개
  TradeFlow.tsx           주문 흐름 전체 (검색·시세·탭·폼·확인 모달)
  AccountCard.tsx         계좌 카드 + 대기주문 체결확인/취소
  JournalList.tsx  JournalReview.tsx    회고 목록 / AI 코멘트
  AiExplain.tsx           AI-1 해석 영역 (구획 파싱)
  PopularStocks.tsx  PriceChart.tsx  RangeBar.tsx
  DividendInfo.tsx  FinancialRatios.tsx  DisclosureNews.tsx
  AppHeader.tsx  AuthButton.tsx  Tutorial.tsx
```

### 🔄 계획과 다른 파일 두 곳

| 계획 | 실제 | 왜 |
|---|---|---|
| ~~`lib/supabase.ts`~~ 1개 파일 | **`lib/supabase/` 아래 3개** — `server.ts`(세션) · `client.ts`(브라우저) · `admin.ts`(service role) | 한 파일에 두면 **service role 키를 쓰는 코드와 브라우저용 코드가 같은 모듈**이 됩니다. 실수로 클라이언트에서 import했을 때 막아줄 장치가 없어 파일 자체를 갈랐습니다 |
| ~~`lib/wallet.ts`~~ (`user_wallets` 조회/생성 + 가상 예산 검증) | **존재하지 않습니다.** `lib/portfolio.ts`의 `getMyPortfolio`가 대체하고, 지갑 생성(upsert)은 `app/api/order/route.ts`에 인라인 | 지정가·매도가 들어오면서 "남은 예산"이 **주문 상태별 계산**(체결분 + 대기중 잔량 예약 − 매도 체결분)이 됐습니다. 지갑 테이블만 보는 함수로는 답이 안 나오고 `orders` 전체를 봐야 해서, 예산·보유수량·매도가능수량을 한 번에 계산하는 `getMyPortfolio`로 합쳤습니다 |

> ⚠️ **지갑 생성이 라우트에 인라인으로 남은 것은 정리를 못 한 것입니다.** `/api/order` 한 곳에서만 쓰이므로 당장 문제는 없지만, `lib/`에 있어야 할 코드가 라우트에 있습니다.

### 🔴 `lib/kis.ts`가 이 프로젝트의 단일 위험 지점입니다

토큰 캐시, 재발급, 재시도, 🆕 **전역 호출 큐**, 그리고 ~~4개~~ 🔄 **11개 엔드포인트**가 모두 여기에 있습니다. 여기가 잘못되면 화면 3개가 모두 죽습니다.

| # | 함수 | KIS 엔드포인트 | tr_id |
|---:|---|---|---|
| 1 | `getQuote` / `getQuotes` | `quotations/inquire-price` | `FHKST01010100` |
| 2 | `getCloses` | `quotations/inquire-daily-itemchartprice` | `FHKST03010100` |
| 3 | `getIntradayCloses` | `quotations/inquire-time-itemchartprice` | `FHKST03010200` |
| 4 | `getPopularStocks` | `quotations/volume-rank` | `FHPST01710000` |
| 5 | `getDividends` | `ksdinfo/dividend` | `HHKDB669102C0` |
| 6 | `getFinancialRatios` | `finance/financial-ratio` | `FHKST66430300` |
| 7 | `getBuyableCash` | `trading/inquire-psbl-order` | `VTTC8908R` |
| 8 | `placeBuyOrder` | `trading/order-cash` | `VTTC0802U` |
| 9 | `placeSellOrder` | `trading/order-cash` | `VTTC0801U` |
| 10 | `checkOrderFill` | `trading/inquire-daily-ccld` | `VTTC0081R` |
| 11 | `cancelOrder` | `trading/order-rvsecncl` | `VTTC0803U` |
| 12 | `getAccountBalance` | `trading/inquire-balance` | `VTTC8434R` |
| — | (공통) 토큰 발급 | `oauth2/tokenP` | — |
| — | (공통) hashkey | `uapi/hashkey` | — |

> ⚠️ **12번 `getAccountBalance`는 죽은 코드입니다 — 호출부가 0건입니다.**
> 흐름 B가 KIS 잔고조회에서 `orders` 합산으로 바뀌면서(1절의 🔄 참고) 쓸 곳이 사라졌는데 **함수는 지우지 않았습니다.** 지금은 아무도 부르지 않으므로 동작에는 영향이 없지만, **읽는 사람은 "계좌 잔고를 KIS에서 가져온다"고 오해할 수 있습니다.** 남겨둔 데 특별한 이유는 없고, 그냥 정리를 안 했습니다.

**대응: Day 1의 첫 작업으로 만들고, 배포본에서 검증합니다.** 화면보다 먼저 만듭니다. ✅ 실제로 그렇게 했고, 그 판단이 통했습니다([[../07_Submit/02_scope_reduction|범위 축소 설명서]] 7절).

---

## 4. KIS 토큰 처리 흐름

> 🔄 **계획은 2계층(DB → 발급)이었는데 실제는 3계층입니다.** 맨 앞에 인메모리 캐시가 붙었습니다.

```
lib/kis.ts :: getAccessToken()

0. 🆕 memoryToken (모듈 전역 변수)이 있고 아직 안 만료됐는가?
   ├─ 예  → 그 토큰을 반환한다 (끝. Supabase 왕복 0회)
   └─ 아니오 ↓
1. kis_tokens 에서 토큰과 expires_at 을 읽는다
2. expires_at 이 현재보다 미래인가?
   ├─ 예  → memoryToken에 채워 넣고 반환한다 (끝)
   └─ 아니오 ↓
3. KIS 토큰 발급 API를 호출한다
4. 성공 → expires_at = 응답 만료시각 - 10분 으로 upsert,
          memoryToken에도 채우고 반환
   실패 → token_refresh_failed 기록 후 에러를 던진다
```

### 🆕 왜 인메모리 계층이 필요했는가

**분봉 조회 하나가 한 요청 안에서 `callKis`를 최대 14번 부릅니다.** DB 캐시만 있으면 페이지마다 Supabase를 한 번씩 더 왕복합니다 — 토큰은 그대로인데 왕복만 13번 낭비됩니다.

```
서버리스 인스턴스가 살아있는 동안 = 메모리 캐시 유효
인스턴스가 죽으면              = 다음 요청이 DB에서 다시 읽음 (2계층이 받아줌)
```

**DB 캐시를 대체한 것이 아니라 앞에 얹은 것입니다.** 서버리스는 메모리를 공유하지 않으므로 인메모리만으로는 [[../07_Submit/02_scope_reduction|범위 축소 설명서]] 3.3절이 지적한 "새로고침마다 재발급" 문제가 그대로 남습니다.

401을 받으면 `invalidateToken()`이 **인메모리와 DB를 모두** 만료 처리합니다. 한쪽만 지우면 죽은 토큰이 살아 돌아옵니다.

### KIS 호출 래퍼

```
callKis(path, options)

1. getAccessToken()
2. 🆕 await reserveKisSlot()   ← 전역 큐. 직전 호출로부터 최소 1,100ms 보장 (4b절)
3. 호출
4. 🔄 응답이 401인가?  (계획은 "인증 오류(401 등)"였지만 실제로는 401만 봅니다)
   ├─ 아니오 → res.ok면 결과 반환, 아니면 에러를 던진다
   └─ 예    → kis_tokens와 memoryToken을 만료 처리하고 getAccessToken() 재실행,
              🔴 딱 1회만 재시도. 두 번째도 실패하면 에러를 던진다
```

### 🔴 왜 1회로 제한합니까?

서버리스에서 재시도 루프는 **요청 폭주**가 됩니다. 사용자가 새로고침을 연타하면 각 요청이 각자 루프를 돌아 KIS 발급 제한에 즉시 걸립니다.

> ⚠️ **`callKis`의 성공 판정은 HTTP 상태만 봅니다.** KIS는 주문 거부도 **HTTP 200 + `rt_cd != "0"`**으로 돌려주므로, `placeCashOrder`·`getBuyableCash`·`cancelOrder` 등이 **각자 `rt_cd`를 직접 검사**해야 합니다. 이 검사를 빠뜨리면 거부된 주문이 성공으로 기록됩니다.

---

## 4b. 🆕 🔴 EGW00201(초당 거래건수 초과) 대응

> **이 절은 계획에 없었습니다.** 위험 목록에 "Vercel에서 KIS를 부를 수 있는가"는 있었지만 **호출 빈도**는 없었고, 실제로 터진 것은 이쪽이었습니다([[../07_Submit/02_scope_reduction|범위 축소 설명서]] 7절). 기능이 늘수록(인기 종목·분봉·배당·주문) 곳곳에서 따로 터졌고, 마지막에 **모든 호출이 지나가는 한 지점**을 막는 것으로 정리했습니다.

**모의투자 도메인은 앱키당 초당 1건입니다.** 앱키가 하나뿐이므로 이 한도는 **사용자 수와 무관하게 서비스 전체가 나눠 씁니다.**

### 1) 전역 큐 — 근본 대응

```ts
// lib/kis.ts
const KIS_MIN_INTERVAL_MS = 1100;
let kisQueue: Promise<void> = Promise.resolve();   // 직렬화
let kisLastCallAt = 0;                             // 마지막 호출 시각
```

`callKis`와 hashkey 발급이 **호출 직전에 반드시 `reserveKisSlot()`을 통과**합니다. 프로미스 체인 하나에 모든 호출을 줄 세우고, 직전 호출로부터 1,100ms가 안 지났으면 그만큼 재웁니다.

- **개별 호출부에서 `sleep`을 흩뿌리지 않습니다.** 그렇게 하면 새 기능이 추가될 때마다 같은 실수를 반복합니다
- ⚠️ **인스턴스 단위입니다.** Vercel이 서버리스 인스턴스를 여러 개 띄우면 큐도 여러 개가 되어 한도를 넘길 수 있습니다. 4일 프로젝트의 트래픽에서는 드러나지 않았고, **해결하지 않았습니다**

### 2) 캐시 — 큐를 덜 쓰게 만드는 대응

큐는 호출을 **느리게** 할 뿐 **줄이지는** 못합니다. 값이 자주 안 변하는 것은 캐시로 호출 자체를 없앱니다.

| 경로 | TTL | inflight 공유 | 실패 시 |
|---|---:|---|---|
| `/api/popular` | 15초 | ✅ | 캐시 있으면 `stale:true`, 없으면 502 |
| `/api/chart` (주/월/년) | 60초 | ✅ (종목+구간별) | 캐시 있으면 `stale`, 없으면 `closes: []` |
| `/api/chart` (일=분봉) | 180초 | ✅ | 위와 같음 |
| `/api/dividend` | 60분 | ✅ (종목별) | 캐시 있으면 `stale`, 없으면 `[]` |
| `/api/financial-ratio` | 60분 | ✅ (종목별) | 위와 같음 |
| ⚠️ `/api/disclosures` | **없음** | ❌ | — (DART·뉴스라 KIS 한도와 무관) |

**`inflight` 공유**: 캐시가 비어 있을 때 요청 3개가 동시에 들어오면 KIS를 3번 부릅니다. 진행 중인 프로미스를 공유해 **1번으로 줄입니다.** 시연처럼 여러 명이 같은 화면을 동시에 여는 상황이 정확히 이 경우입니다.

### 3) 반복 호출 경로의 개별 예산

| 경로 | 규칙 | 왜 |
|---|---|---|
| `getQuotes` (여러 종목) | 종목 사이 400ms + 실패 시 900ms 백오프 후 1회 재시도 + **7초 데드라인** | 250ms에서는 멀쩡한 종목도 실패했습니다. "레이트리밋 실패"와 "없는 종목"은 응답만으로 구분이 안 되므로 **일단 재시도**하고, 그래도 실패할 때만 `null`로 확정합니다. 이 구분이 없으면 멀쩡한 종목이 화면에서 `—`로 보입니다 |
| `getIntradayCloses` (분봉) | 최대 14페이지, 실패 시 900ms 후 1회 재시도, **40초 데드라인** | 하루치(390분)를 30분씩 끊어 받습니다. 페이지마다 큐의 1.1초가 붙어 오후로 갈수록 느려집니다. 예산을 넘기면 **남은 페이지를 포기하고 그때까지 모은 것만** 보여줍니다 |

> 🔄 **분봉 데드라인은 7초에서 40초로 늘렸습니다.** 처음엔 Vercel Hobby의 10초 제한에 맞춰 7초로 뒀는데, 큐(1.1초/페이지) 때문에 오후에는 장 시작까지 못 채우고 **최근 1~2시간만 그려지는** 문제가 있었습니다. `maxDuration`을 45초로 올리고(7절) 예산도 같이 늘렸습니다.

### 4) 라우트를 나눈 것도 이 대응의 일부입니다

`/api/budget`이 `/api/account`에서 갈라져 나온 이유가 여기 있습니다. 주문 화면은 예산 한 줄만 필요한데 `/api/account`는 보유 종목 수만큼 KIS를 부릅니다. **`/api/budget`은 KIS를 한 번도 부르지 않습니다**(Supabase 조회뿐).

---

## 5. 🔴 `/api/order` 처리 순서

이 순서가 이 프로젝트의 안전장치입니다.

```
POST /api/order  { stockCode, side, qty, reasonType, reasonMemo, orderType, limitPrice }
(user_id는 body에 넣지 않음. 서버가 Supabase Auth 세션에서 직접 확인 — 조작 불가)

1. 입력 검증          qty > 0(정수), reasonType이 side별 허용 목록에 있는가,
                      지정가면 정수 + 호가단위 배수인가
                      → 실패: 400, orders 행 생성하지 않음

2. 🔴 로그인 확인       supabase.auth.getUser() 로 세션 검증
                      → 실패: 401, "로그인이 필요합니다" (예외 2.10)

3. 장 시간 검증        평일 09:00~15:30 (KST)
                      → 실패: 🔄 200 + code:"market_closed" (예외 2.4)

4. 종목 확인           stocks 에 stockCode 가 있고 is_active
                      → 실패: 🔄 400 + code:"invalid_input"

5. 중복 검증           60초 내 동일 (stockCode, side, qty) 주문 존재?
                      → 존재: 🔄 200 + code:"duplicate" (예외 2.6)

6. 가격 확정           🔄 시장가만 KIS 시세 조회 → 실패: 502
                      지정가는 클라이언트가 보낸 limitPrice를 그대로 사용

7. 지갑 upsert         🔄 user_wallets에 user_id 없으면 기본 예산(500만원)으로 생성
                      (admin 클라이언트, ignoreDuplicates) ⚠️ 결과를 검사하지 않음

8. 포트폴리오 계산      getMyPortfolio — orders 전체에서 remaining·availableToSell 산출
                      (Supabase만, KIS 없음)

9. 🔴 한도 검증        매수: 가상 예산  expectedAmount ≤ remaining
                             → 실패: 🔄 200 + code:"budget_exceeded" (예외 2.11)
                      매도: 보유수량   qty ≤ availableToSell[stockCode]
                             → 실패: 🔄 200 + code:"oversell"

10. 🔴 실제 예수금      🔄 매수만. KIS 주문가능현금(ord_psbl_cash)과 비교
                      → 조회 실패: 502 / 부족: 200 + code:"insufficient_funds" (예외 2.5)

11. orders INSERT      status = 'requested', user_id·side·order_type·limit_price 포함
                       → 실패: 502
12. rationales INSERT  🔴 KIS 호출 **전에** 저장
13. KIS 주문 호출       매수 VTTC0802U / 매도 VTTC0801U (hashkey 1회 + 주문 1회)
14. 성공 → orders UPDATE
             시장가: status='filled',    filled_qty=qty, filled_price=price
             지정가: status='submitted', filled_qty=0   (대기중)
    실패 → orders UPDATE (status='rejected', reject_reason)
             → 🔄 200 + code:"kis_rejected"
15. 이벤트 기록 후 응답  { ok, orderId, orderNo, status }
```

> 🔄 **상태코드가 대부분 200입니다.** 화면이 "네트워크 오류"와 "업무 규칙에 걸림"을 구분할 필요가 없게 만들기 위해서입니다 — AI 실패를 200으로 돌려주는 것과 같은 원칙입니다. 단계별 대조표는 [[01_data_flow|데이터 흐름]] 3절에 있습니다.

### 검증 순서를 이렇게 둔 이유

| 원칙 | 적용 | 실제 |
|---|---|---|
| 싼 검증을 먼저 | 1~5는 외부 호출 없이(또는 Supabase 조회 하나로) 판정됩니다. 여기서 걸리면 KIS를 부르지 않습니다 | ✅ **계획보다 더 잘 지켜졌습니다** — 중복 검증(5)이 시세 조회(6)보다 앞으로 왔습니다 |
| 신원부터 확인 | 2번(로그인)이 예산과 관련된 모든 단계보다 앞입니다 | ✅ 그대로 |
| 쓰기를 뒤로 | 지갑 생성(7)은 **쓰기**입니다. 걸러질 요청이 행을 만들 이유가 없습니다 | 🔄 계획에서는 3번째였습니다 |
| 비가역 작업을 마지막에 | KIS 주문(13번)이 가장 뒤에 있습니다 | ✅ 그대로 |
| 근거를 주문보다 먼저 저장 | 12번이 13번보다 앞입니다. 주문이 실패해도 근거는 남습니다 | ✅ 그대로 |
| ~~계좌 전체 → 사용자 개인 순서로 검증~~ | ~~7번(실제 예수금)이 8번(가상 예산)보다 앞입니다. **계좌 자체가 부족하면 사용자 한도를 볼 필요도 없습니다**~~ | 🔄 **정반대가 됐습니다** (아래) |

### 🔄 실제 예수금과 가상 예산의 순서가 뒤집혔습니다

**계획**: 실제 예수금 → 가상 예산. **코드**(9 → 10): 가상 예산 → 실제 예수금.

`app/api/order/route.ts` 상단 주석이 그 근거를 명시합니다.

> *"가상 예산을 실제 예수금보다 먼저 보는 이유는, 가상 예산이 '사용자 1명이 계좌를 몰아 쓰는 것'을 막는 1차 방어선이고 실제 예수금 확인은 계좌 전체를 지키는 최종 방어선이기 때문입니다."*

**코드 쪽 판단이 옳았습니다.**

| | 계획(예수금 먼저) | 코드(예산 먼저) |
|---|---|---|
| KIS 호출 | 예산 초과가 뻔한 요청에도 `getBuyableCash`를 **반드시** 부릅니다. 전역 큐 때문에 그 자체로 최소 1.1초를 태우고 다른 사용자의 호출을 밀어냅니다 | 예산에서 걸리면 **KIS를 아예 안 부릅니다** |
| 사용자에게 보이는 사유 | "계좌 예수금이 부족합니다" — **본인이 고칠 수 없는 사유** | "가상 예산을 초과했습니다. 남은 한도 OOO원, 수량을 줄여보세요" — **바로 고칠 수 있는 사유** |

**같은 표의 "싼 검증을 먼저"와 정면으로 모순됐던 것**이 계획의 잘못입니다. 가장 비싼 검증(KIS 왕복)을 맨 앞에 두면서 그걸 원칙 위반으로 인식하지 못했습니다. 계획의 근거였던 *"계좌가 부족하면 개인 한도를 볼 필요도 없다"*는, **가상 예산 500만원 × 사용자 수가 계좌 예수금을 넘기 전에는 일어나지 않는 상황**입니다 — 드문 실패를 매번 일어나는 실패보다 앞에 뒀습니다.

> 🔴 **7번과 8번은 서로 다른 것을 지킵니다.** 예수금 검증이 없으면 계좌 전체가 위험하고, 예산 검증이 없으면 한 사용자가 계좌를 몰아 씁니다. 두 검증 모두 있어야 [[../02_Domain/02_user_roles|사용자 역할]]에서 설명한 "계좌 1개를 여러 사용자가 안전하게 나눠 쓰는" 구조가 완성됩니다. **이 문장은 지금도 맞습니다 — 바뀐 것은 순서뿐이고, 두 검증 다 그대로 있습니다.**
>
> ⚠️ **단, 매도에는 실제 예수금 검증이 없습니다.** 파는 데는 현금이 필요 없어 설계상 의도한 것이지만, 검증 경로가 매수와 갈라졌습니다. 매도 한도는 `orders` 기준 `availableToSell`이고 **공유 모의계좌의 실제 잔고와 대조하지 않습니다** — KIS가 거부하면 그 거부를 그대로 사용자에게 전달합니다(`lib/kis.ts`의 `placeSellOrder` 주석).
>
> ⚠️ **지정가 가격은 서버가 시세와 대조하지 않습니다.** 호가단위 배수인지만 봅니다 — 알려진 한계입니다([[01_data_flow|데이터 흐름]] 3절, [[../07_Submit/02_scope_reduction|범위 축소 설명서]] 6절).

---

## 6. 렌더링 전략

| 화면 | 방식 | 이유 |
|---|---|---|
| `/` | Client Component(`AccountCard`) + `/api/account` | 계좌는 실시간 값. 캐시하면 안 됩니다 |
| `/trade` | Client Component(`TradeFlow`) | 검색·수량 입력 등 상호작용 중심 |
| `/journal` | Server Component(목록·집계) + Client(🔄 **현재가 대조**, AI 버튼) | 저장된 데이터라 서버에서 그리는 게 빠릅니다 |

> 🔄 **`/journal`의 현재가 대조도 Client입니다.** 계획에서는 Server Component가 KIS까지 불러 완성된 HTML을 주는 모양이었는데, 그러면 **현재가를 다 받을 때까지 화면에 아무것도 안 나옵니다.** 종목 10개면 전역 큐 때문에 10초가 넘습니다. 회고 화면을 시연의 최종 안전판으로 삼기로 한 이상, 그 화면이 외부 API를 기다리게 둘 수 없어 `components/JournalList.tsx`가 마운트 후 `POST /api/quotes`로 따로 가져옵니다. **결과적으로 계획보다 더 안전해졌습니다.**

```ts
export const dynamic = 'force-dynamic'  // 계좌·시세 관련 route
```

### 🔴 캐시를 끄는 것이 중요합니다

Next.js App Router는 기본적으로 `fetch`를 캐시합니다. **계좌 잔고가 캐시되면 주문 후에도 옛 예수금이 보입니다.** 시연에서 바로 드러나는 종류의 버그입니다.

> 🆕 **4b절의 TTL 캐시와 혼동하면 안 됩니다.** `force-dynamic`으로 끄는 것은 **프레임워크의 자동 캐시**이고, 4b절의 캐시는 **우리가 의도적으로 넣은 모듈 변수 캐시**입니다. 전자는 예상 못 한 시점에 낡은 값을 보여주지만, 후자는 TTL과 `stale` 표시를 우리가 정합니다.

---

## 7. 🔴 Vercel 실행 시간 제한 대응

Hobby 플랜의 Route Handler 기본 제한은 10초입니다.

> 🔄 **`/api/chart`만 예외로 45초를 씁니다.** `export const maxDuration = 45`(`app/api/chart/route.ts`). "일"(분봉) 구간이 하루치를 최대 14페이지 이어붙이는데, 전역 큐의 1.1초/페이지 때문에 10초로는 오후에 장 시작까지 못 채웁니다. 값은 `lib/kis.ts`의 `INTRADAY_DEADLINE_MS`(40초)보다 커야 합니다 — 응답 직렬화 여유분입니다.

| 경로 | 예상 소요 | 위험 |
|---|---:|---|
| `/api/account` | KIS = 보유 종목 수 (종목당 ≈1.5s, 7초 데드라인) | 보통 |
| `/api/budget` | KIS 0회 | 낮음 |
| `/api/quote` | KIS 1회 ≈ 1s | 낮음 |
| `/api/stocks` | KIS 0회 | 낮음 |
| 🔄 `/api/order` | ~~KIS 3회 ≈ 3s~~ → **시장가 매수 4회 = 최소 4.4s** (아래) | 🔴 **높음** |
| 🆕 `/api/popular` | KIS 1회 ≈ 1s (캐시 적중 시 0회) | 낮음 |
| 🆕 `/api/quotes` | KIS = 종목 수 × ≈1.5s, **7초 데드라인** | 보통 |
| 🆕 `/api/chart` (주/월/년) | KIS 1회 ≈ 1s | 낮음 |
| 🆕 `/api/chart` (일=분봉) | KIS **최대 14회**, 40초 예산 → `maxDuration = 45` | 🔴 **높음** |
| 🆕 `/api/dividend`·`/api/financial-ratio` | KIS 1회 (캐시 적중 시 0회) | 낮음 |
| 🆕 `/api/disclosures` | DART + 뉴스 병렬, 각 5초 타임아웃 | 낮음 |
| `/api/ai/explain` | Gemini ≈ 2~5s (+ 시세·공시·뉴스) | ⚠️ |
| `/api/ai/review` | Gemini ≈ 3~8s | 🔴 **높음** |

### 🔄 `/api/order`의 KIS 호출 횟수

계획은 "3회 ≈ 3s"였습니다. 실제로는 **경로마다 다르고, 전역 큐 때문에 호출 수 × 1.1초가 바닥**입니다.

| 경로 | KIS 호출 | 최소 소요 |
|---|---|---:|
| 매수 시장가 | 시세 + 예수금 + hashkey + 주문 = **4회** | **≈ 4.4s** |
| 매수 지정가 | 예수금 + hashkey + 주문 = 3회 | ≈ 3.3s |
| 매도 시장가 | 시세 + hashkey + 주문 = 3회 | ≈ 3.3s |
| 매도 지정가 | hashkey + 주문 = 2회 | ≈ 2.2s |

⚠️ **가장 흔한 경로(매수 시장가)가 10초 제한의 절반을 씁니다.** 여유가 5초 남짓뿐인데, 여기에 Supabase 왕복이 10회 넘게 더 붙습니다(인증·종목·중복·지갑·포트폴리오·주문·근거·상태갱신·이벤트 2건). 4일 동안 이 제한에 걸린 적은 없지만 **여유가 넉넉하지도 않습니다.**

### 대응

| 대응 | 내용 |
|---|---|
| Gemini 타임아웃 8초 | 10초에 걸리기 전에 우리가 먼저 끊고 예외 2.7로 처리 (`AbortSignal.timeout`) |
| 🆕 Gemini `thinkingBudget: 0` | 사고 과정을 끄지 않으면 짧은 답변에도 지연이 크게 늘어납니다 |
| 회고 코멘트 입력 축소 | 최근 20건만 넘깁니다. 전체를 넘기면 토큰이 늘고 느려집니다 |
| 🔄 프롬프트에 길이 제한 | ~~"4문장 이내"~~ → **구획별 2~3문장**(`제목\|내용` 형식). 응답 상한은 `maxOutputTokens: 2048` |
| `/api/order`에 AI 없음 | 주문 경로는 AI와 무관합니다 |
| 🆕 `/api/quotes` 20종목 상한 | 회고가 쌓여도 10초를 넘기지 않게 |
| 🆕 데드라인 후 부분 결과 | 분봉·다종목 시세는 시간이 다하면 **모은 만큼만** 돌려줍니다 (`timedOut` / 짧은 차트) |

---

## 8. 배포 구성

| 항목 | 내용 |
|---|---|
| 리포지토리 | GitHub |
| 배포 | Vercel (GitHub 연동, `main` push 시 자동) |
| 🆕 **리전** | **`vercel.json`의 `"regions": ["icn1"]` (서울)** |
| 환경변수 | Vercel 대시보드에 Production + Preview 양쪽 등록 (`DART_API_KEY` 포함) |
| 도메인 | Vercel 기본 도메인 사용 (커스텀 도메인 없음) |

### 🆕 🔴 리전을 한국으로 고정한 이유

```json
{ "regions": ["icn1"] }
```

Vercel 기본 리전은 미국(`iad1`)입니다. **KIS 서버는 한국에 있고, 모든 KIS 호출이 태평양을 왕복하고 있었습니다.**

이게 특히 아팠던 곳이 **분봉 차트**입니다. 최대 14번을 순차로 부르는데, 왕복 지연이 페이지마다 그대로 쌓입니다. 전역 큐의 1.1초와 겹쳐 데드라인 안에 하루치를 못 채우는 원인 중 하나였습니다. `icn1`으로 옮겨 왕복 지연을 줄였습니다.

> ⚠️ **얼마나 빨라졌는지 수치로 재지는 않았습니다.** 차트가 눈에 띄게 빨리 채워지는 것만 확인했고, 리전 변경 전후를 나란히 측정하지 않았습니다. **없는 숫자를 적지 않겠습니다.**
>
> DART(`opendart.fss.or.kr`)도 국내라 같은 방향으로 이득입니다. ⚠️ **반대로 느려졌을 수 있는 Gemini·구글 뉴스는 측정하지 않았습니다** — 각각 8초·5초 타임아웃 안에서 문제가 드러나지 않아 그대로 뒀습니다.

### 🔴 Day 1에 빈 화면이라도 먼저 배포합니다

```
이유: 배포는 개발 마지막에 하면 반드시 문제가 생깁니다.
     환경변수 누락, 빌드 에러, 타입 에러가 마지막 날에 몰립니다.
대응: Day 1에 "Hello"만 있는 상태로 배포해 URL을 확보하고,
     이후 매일 push 합니다.
```

**REQ-04가 요구하는 것은 접속 가능한 주소입니다.** 그 주소를 Day 1에 확보해 두면 남은 3일은 그 위에 얹는 일만 남습니다. ✅ 실제로 그렇게 했습니다.

---

## 9. 프로젝트 2 대비 구조 비교

| 항목 | 프로젝트 2 (n8n) | 프로젝트 3 (Next.js) |
|---|---|---|
| 실행 단위 | 워크플로우 | Route Handler |
| 상태 보관 | DB + n8n 실행 컨텍스트 | **화면 + DB** |
| 토큰 보관 | Credential | 🔄 **DB 캐시 + 인메모리 캐시** (4절) |
| 의도 파악 | LLM 분류 | 라우팅 |
| 로직 위치 | 노드 그래프 | TypeScript 함수 |
| 디버깅 | Executions 화면 | 서버 로그 + `event_logs` |
| 배포 | n8n 인스턴스 상주 | Git push |
| 🆕 외부 API 레이트리밋 | n8n 노드가 순차 실행이라 자연히 완화됨 | 🔴 **직접 큐를 만들어야 했습니다** (4b절) |

### 🔴 잃은 것도 있습니다

| 잃은 것 | 대응 |
|---|---|
| n8n Executions의 실행 이력 시각화 | `event_logs` + Vercel 로그로 대체. **시각화는 없습니다** |
| 상주 프로세스 (스케줄러 가능) | 🔄 만료 정리는 여전히 필요 없지만, **체결 조회는 사용자가 버튼을 눌러야 합니다.** 자동 폴링을 못 만든 이유가 이것입니다 |
| Credential의 자격증명 격리 | 환경변수 + `NEXT_PUBLIC_` 금지 + 🆕 `import "server-only"`로 대체 |
| 🆕 노드 단위 순차 실행 | 서버리스는 요청마다 병렬로 뜹니다. KIS 초당 1건을 지키려면 **전역 큐를 직접 만들어야 했습니다**(4b절) |

**Executions 상실이 실질적 손해입니다.** 프로젝트 2는 "확인 동의 전에 KIS가 호출되지 않았는가"를 Executions 화면으로 검증했습니다. 프로젝트 3에서는 **`event_logs`와 `orders.status`로 확인**해야 합니다. 완료 기준에 그렇게 적었습니다.

> ⚠️ **`event_logs`도 빈틈이 있습니다.** `/api/account`에는 `logEvent` 호출이 **하나도 없어** 계좌 화면 조회는 기록되지 않습니다([[01_data_flow|데이터 흐름]] 1절). 주문 경로(`/api/order`)는 단계별로 촘촘히 남기지만, 조회 경로는 `/api/quote`의 `quote_retrieved` 정도뿐입니다.

---

## 관련 문서

- [[01_data_flow|데이터 흐름]]
- [[../03_Data_Event/01_data_structure|데이터 구조]]
- [[../03_Data_Event/02_data_sources|데이터 소스]]
- [[../05_Scope/01_mvp_scope|MVP 범위와 우선순위]]
- [[../06_WBS/01_wbs|WBS]]
