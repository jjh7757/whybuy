# 아키텍처

- 작성일: 2026-08-06

---

## 1. 전체 구성

```
[사용자] ── 브라우저
    │
    ▼
┌───────────────────────────────────────────┐
│  Next.js (App Router) — Vercel 배포        │
│                                           │
│  화면 (Server / Client Component)          │
│    /          계좌 대시보드                 │
│    /trade     종목 조회 + 주문              │
│    /journal   근거 회고                     │
│                                           │
│  서버 로직 (Route Handler)                  │
│    /api/account     계좌 조회               │
│    /api/quote       시세 조회                │
│    /api/stocks      종목 검색                │
│    /api/order       🔴 주문 실행             │
│    /api/ai/explain  AI-1 해석               │
│    /api/ai/review   AI-2 회고               │
└───────────────────────────────────────────┘
      │            │              │
      │            │              ▼
      │            │        ┌───────────┐
      │            │        │  KIS API  │ 모의투자
      │            │        └───────────┘
      │            ▼
      │      ┌───────────┐
      │      │ Gemini API│
      │      └───────────┘
      ▼
┌─────────────────────────┐
│       Supabase          │
│  stocks / orders /      │
│  rationales /           │
│  kis_tokens / event_logs│
└─────────────────────────┘
```

요청서의 시스템 구성도와 동일한 구조이고, KIS API가 하나 더 붙었습니다.

---

## 2. 🔴 절대 규칙 — 외부 API는 서버에서만 호출합니다

```
브라우저 ──❌──> KIS API      (앱키가 노출됩니다)
브라우저 ──❌──> Gemini API   (API 키가 노출됩니다)
브라우저 ──✅──> /api/*  ──> KIS / Gemini
```

### 판별 기준

| 이 값을 쓰는 코드는 | 어디에 있어야 하는가 |
|---|---|
| `KIS_APP_KEY` | `app/api/**` 또는 `lib/**` (서버 전용) |
| `GEMINI_API_KEY` | 동일 |
| `NEXT_PUBLIC_SUPABASE_*` | 어디든 (공개 전제) |
| Google OAuth 클라이언트 시크릿 | Supabase 대시보드에만 등록 (앱 코드에는 없음) |

> `user_id`는 쿠키가 아니라 **Supabase Auth 세션**에서 나옵니다. `auth.getUser()`가 서버에서 세션 쿠키를 검증해 실제 로그인된 사용자의 UUID를 돌려줍니다. 클라이언트가 값을 조작할 수 없습니다.

> 🔴 **`'use client'`가 붙은 파일에서 위 3개를 import하면 안 됩니다.** Next.js는 서버 전용 환경변수를 클라이언트에서 읽으면 `undefined`를 주므로 조용히 실패합니다. 배포 후에야 드러납니다.

---

## 3. 레이어 구성

```
app/
  page.tsx              계좌 대시보드
  trade/page.tsx        종목 조회 + 주문
  journal/page.tsx      근거 회고
  auth/callback/route.ts  Google OAuth 콜백
  api/
    account/route.ts
    quote/route.ts
    stocks/route.ts
    order/route.ts      🔴 핵심
    ai/explain/route.ts
    ai/review/route.ts
lib/
  kis.ts                KIS 호출 + 토큰 캐시
  gemini.ts             Gemini 호출 + 프롬프트
  supabase.ts           서버/브라우저 클라이언트 생성 (Auth 세션 포함)
  events.ts             이벤트 기록
  market.ts             장 운영시간 판정
  wallet.ts             user_wallets 조회/생성 + 가상 예산 검증
components/
  ...
```

### 🔴 `lib/kis.ts`가 이 프로젝트의 단일 위험 지점입니다

토큰 캐시, 재발급, 재시도, 4개 엔드포인트가 모두 여기에 있습니다. 여기가 잘못되면 화면 3개가 모두 죽습니다.

**대응: Day 1의 첫 작업으로 만들고, 배포본에서 검증합니다.** 화면보다 먼저 만듭니다.

---

## 4. KIS 토큰 처리 흐름

```
lib/kis.ts :: getAccessToken()

1. kis_tokens 에서 토큰과 expires_at 을 읽는다
2. expires_at 이 현재보다 미래인가?
   ├─ 예  → 그 토큰을 반환한다 (끝)
   └─ 아니오 ↓
3. KIS 토큰 발급 API를 호출한다
4. 성공 → expires_at = 응답 만료시각 - 10분 으로 upsert, 반환
   실패 → token_refresh_failed 기록 후 에러를 던진다
```

### KIS 호출 래퍼

```
callKis(endpoint, params)

1. getAccessToken()
2. 호출
3. 인증 오류(401 등)인가?
   ├─ 아니오 → 결과 반환
   └─ 예   → kis_tokens 를 만료 처리하고 getAccessToken() 재실행,
             🔴 딱 1회만 재시도. 두 번째도 실패하면 에러를 던진다
```

### 🔴 왜 1회로 제한합니까?

서버리스에서 재시도 루프는 **요청 폭주**가 됩니다. 사용자가 새로고침을 연타하면 각 요청이 각자 루프를 돌아 KIS 발급 제한에 즉시 걸립니다.

---

## 5. 🔴 `/api/order` 처리 순서

이 순서가 이 프로젝트의 안전장치입니다.

```
POST /api/order  { stockCode, qty, reasonType, reasonMemo }
(user_id는 body에 넣지 않음. 서버가 Supabase Auth 세션에서 직접 확인 — 조작 불가)

1. 입력 검증          qty > 0, reasonType 이 허용 목록에 있는가
                      → 실패: 400, orders 행 생성하지 않음

2. 🔴 로그인 확인       supabase.auth.getUser() 로 세션 검증
                      → 실패: 401, "Google로 로그인해주세요" (예외 2.10)

3. 예산 조회/생성      user_wallets 에 user_id 없으면 기본 예산(500만원)으로 생성
                      → 실패: 500

4. 장 시간 검증        평일 09:00~15:30 (KST)
                      → 실패: 422 + 운영시간 안내

5. 종목 확인           stocks 에 stockCode 가 있고 is_active
                      → 실패: 404

6. 시세 조회           KIS → expected_price 확보
                      → 실패: 502

7. 예수금 검증         KIS 잔고 조회 → expected_amount 와 비교 (계좌 전체 안전판)
                      → 실패: 422 + 잔액·필요액 안내

8. 🔴 가상 예산 검증    user_id의 누적 submitted 합계 + expected_amount ≤ allocated_amount
                      → 실패: 422 + 남은 한도 안내 (예외 2.11)

9. 중복 검증           60초 내 동일 (stockCode, qty) 주문 존재?
                      → 존재: 409 + 기존 주문 안내

10. orders INSERT      status = 'requested', user_id 포함
11. rationales INSERT  🔴 KIS 호출 **전에** 저장
12. KIS 매수 주문 호출
13. 성공 → orders UPDATE (status='submitted', order_no)
    실패 → orders UPDATE (status='rejected', reject_reason)
14. 이벤트 기록 후 응답
```

### 검증 순서를 이렇게 둔 이유

| 원칙 | 적용 |
|---|---|
| 싼 검증을 먼저 | 1~4는 외부 호출 없이 판정됩니다. 여기서 걸리면 KIS를 부르지 않습니다 |
| 신원부터 확인 | 2번(로그인)이 3번(예산 조회)보다 앞입니다. 로그인하지 않은 요청이 예산을 만들어낼 이유가 없습니다 |
| 비가역 작업을 마지막에 | KIS 주문(12번)이 가장 뒤에 있습니다 |
| 근거를 주문보다 먼저 저장 | 11번이 12번보다 앞입니다. 주문이 실패해도 근거는 남습니다 |
| 계좌 전체 → 사용자 개인 순서로 검증 | 7번(실제 예수금)이 8번(가상 예산)보다 앞입니다. **계좌 자체가 부족하면 사용자 한도를 볼 필요도 없습니다** |

> 🔴 **7번과 8번은 서로 다른 것을 지킵니다.** 7번이 없으면 계좌 전체가 위험하고, 8번이 없으면 한 사용자가 계좌를 몰아 씁니다. 두 검증 모두 있어야 [[../02_Domain/02_user_roles|사용자 역할]]에서 설명한 "계좌 1개를 여러 사용자가 안전하게 나눠 쓰는" 구조가 완성됩니다.

---

## 6. 렌더링 전략

| 화면 | 방식 | 이유 |
|---|---|---|
| `/` | Client Component + `/api/account` | 계좌는 실시간 값. 캐시하면 안 됩니다 |
| `/trade` | Client Component | 검색·수량 입력 등 상호작용 중심 |
| `/journal` | Server Component (초기) + Client(AI 버튼) | 저장된 데이터라 서버에서 그리는 게 빠릅니다 |

```ts
export const dynamic = 'force-dynamic'  // 계좌·시세 관련 route
```

### 🔴 캐시를 끄는 것이 중요합니다

Next.js App Router는 기본적으로 `fetch`를 캐시합니다. **계좌 잔고가 캐시되면 주문 후에도 옛 예수금이 보입니다.** 시연에서 바로 드러나는 종류의 버그입니다.

---

## 7. 🔴 Vercel 실행 시간 제한 대응

Hobby 플랜의 Route Handler 제한은 10초입니다.

| 경로 | 예상 소요 | 위험 |
|---|---:|---|
| `/api/account` | KIS 1회 ≈ 1s | 낮음 |
| `/api/quote` | KIS 1회 ≈ 1s | 낮음 |
| `/api/order` | KIS 3회 ≈ 3s | 보통 |
| `/api/ai/explain` | Gemini ≈ 2~5s | ⚠️ |
| `/api/ai/review` | Gemini ≈ 3~8s | 🔴 **높음** |

### 대응

| 대응 | 내용 |
|---|---|
| Gemini 타임아웃 8초 | 10초에 걸리기 전에 우리가 먼저 끊고 예외 2.7로 처리 |
| 회고 코멘트 입력 축소 | 최근 20건만 넘깁니다. 전체를 넘기면 토큰이 늘고 느려집니다 |
| 프롬프트에 길이 제한 | "4문장 이내" |
| `/api/order`에 AI 없음 | 주문 경로는 AI와 무관합니다 |

---

## 8. 배포 구성

| 항목 | 내용 |
|---|---|
| 리포지토리 | GitHub |
| 배포 | Vercel (GitHub 연동, `main` push 시 자동) |
| 환경변수 | Vercel 대시보드에 Production + Preview 양쪽 등록 |
| 도메인 | Vercel 기본 도메인 사용 (커스텀 도메인 없음) |

### 🔴 Day 1에 빈 화면이라도 먼저 배포합니다

```
이유: 배포는 개발 마지막에 하면 반드시 문제가 생깁니다.
     환경변수 누락, 빌드 에러, 타입 에러가 마지막 날에 몰립니다.
대응: Day 1에 "Hello"만 있는 상태로 배포해 URL을 확보하고,
     이후 매일 push 합니다.
```

**REQ-04가 요구하는 것은 접속 가능한 주소입니다.** 그 주소를 Day 1에 확보해 두면 남은 3일은 그 위에 얹는 일만 남습니다.

---

## 9. 프로젝트 2 대비 구조 비교

| 항목 | 프로젝트 2 (n8n) | 프로젝트 3 (Next.js) |
|---|---|---|
| 실행 단위 | 워크플로우 | Route Handler |
| 상태 보관 | DB + n8n 실행 컨텍스트 | **화면 + DB** |
| 토큰 보관 | Credential | 🔴 **DB 캐시** |
| 의도 파악 | LLM 분류 | 라우팅 |
| 로직 위치 | 노드 그래프 | TypeScript 함수 |
| 디버깅 | Executions 화면 | 서버 로그 + `event_logs` |
| 배포 | n8n 인스턴스 상주 | Git push |

### 🔴 잃은 것도 있습니다

| 잃은 것 | 대응 |
|---|---|
| n8n Executions의 실행 이력 시각화 | `event_logs` + Vercel 로그로 대체. **시각화는 없습니다** |
| 상주 프로세스 (스케줄러 가능) | 필요 없어졌습니다. 만료 정리가 사라졌기 때문 |
| Credential의 자격증명 격리 | 환경변수 + `NEXT_PUBLIC_` 금지 규칙으로 대체 |

**Executions 상실이 실질적 손해입니다.** 프로젝트 2는 "확인 동의 전에 KIS가 호출되지 않았는가"를 Executions 화면으로 검증했습니다. 프로젝트 3에서는 **`event_logs`와 `orders.status`로 확인**해야 합니다. 완료 기준에 그렇게 적었습니다.

---

## 관련 문서

- [[01_data_flow|데이터 흐름]]
- [[../03_Data_Event/01_data_structure|데이터 구조]]
- [[../03_Data_Event/02_data_sources|데이터 소스]]
- [[../06_WBS/01_wbs|WBS]]
