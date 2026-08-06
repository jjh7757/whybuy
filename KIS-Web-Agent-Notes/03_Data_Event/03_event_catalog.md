# 이벤트 카탈로그

- 작성일: 2026-08-06

---

## 0. 이벤트를 기록하는 이유

**발표에서 "동작합니다"라고만 말하지 않기 위해서입니다.**

```
❌ "AI가 계좌를 해석해줍니다"
✅ "4일 동안 계좌 해석 23회, 종목 조회 41회, 주문 6건이 있었고
    근거 기록률은 6건 중 6건입니다"
```

이벤트가 없으면 두 번째 문장을 만들 수 없습니다.

---

## 1. 작성 규칙

| 규칙 | 예 |
|---|---|
| 과거형 | `order_submitted` (✅) / `submit_order` (❌) |
| `snake_case` | `stock_resolution_failed` |
| 실패는 `_failed` 또는 `_blocked` | `llm_call_failed` |
| 도메인/운영 구분 | `event_category` = `domain` / `operation` |

**도메인 이벤트**는 사용자에게 의미 있는 사건입니다. **운영 이벤트**는 시스템 내부 사건입니다.

---

## 2. 도메인 이벤트 (Must — 7개)

| # | 이벤트 | 발생 시점 | `payload` |
|---:|---|---|---|
| 1 | `account_diagnosed` | AI-1이 계좌를 해석함 | `{ deposit, total_eval, profit_rate }` 🔄 `deposit`은 실제 계좌 예수금이 아니라 **이 사용자의 남은 가상 예산**입니다. 계좌 화면이 공용 KIS 잔고 대신 로그인 사용자가 이 서비스로 주문한 종목 기준으로 바뀌었기 때문입니다 (2026-08-06, [[../02_Domain/03_workflow|업무 흐름]] 흐름 B). |
| 2 | `quote_retrieved` | 종목 시세를 조회함 | `{ stock_code, price, change_rate }` |
| 3 | `order_submitted` | KIS에 주문이 접수됨 | `{ stock_code, qty, expected_price, order_no }` |
| 4 | `order_rejected` | 주문이 거부됨 | `{ stock_code, qty, reason }` |
| 5 | `rationale_recorded` | 판단 근거가 저장됨 | `{ reason_type, has_memo }` |
| 6 | `journal_reviewed` | AI-2 회고 코멘트를 생성함 | `{ order_count, gut_ratio }` |
| 7 | `term_explained` | AI-3가 용어를 설명함 (Should) | `{ term }` |

### 🔴 5번과 6번이 성공 기준을 담습니다

| 이벤트 | 측정하는 것 |
|---|---|
| `rationale_recorded` | 근거를 실제로 적었는가 (기록률) |
| `journal_reviewed` | 회고 화면을 실제로 썼는가 (**회고가 일어났는가**) |

6번이 특히 중요합니다. 회고 화면을 만들어 놓고 **아무도 안 눌렀다면** 이 프로젝트의 가정은 검증되지 않은 것입니다. 발표에서 그렇게 말해야 합니다.

---

## 3. 운영 이벤트 (Must — 5개)

| # | 이벤트 | 발생 시점 | `payload` |
|---:|---|---|---|
| 8 | `token_refreshed` | KIS 토큰을 재발급함 | `{ expires_at }` |
| 9 | `token_refresh_failed` | 🔴 재발급 실패 | `{ status, message }` |
| 10 | `llm_call_failed` | Gemini 호출 실패·타임아웃 | `{ purpose, error }` |
| 11 | `stock_resolution_failed` | 종목을 찾지 못함 | `{ input }` |
| 12 | `order_rejected_budget_exceeded` | 사용자의 가상 예산 초과 | `{ user_id, requested_amount, remaining }` |

### 9번을 최우선으로 보는 이유

토큰 재발급 실패는 **화면상으로는 "잠시 후 다시 시도해주세요"로만 보입니다.** 원인이 무엇인지 알 방법이 이 이벤트뿐입니다. 발표 당일 시연이 안 될 때 30초 안에 원인을 판단해야 합니다.

### 11번이 프롬프트 개선의 재료입니다

사용자가 어떤 표현으로 종목을 찾는지 `input`에 쌓입니다. `삼전`, `SK하닉` 같은 줄임말이 많으면 별칭 컬럼을 추가할 근거가 됩니다.

> ⚠️ 4일 안에 별칭을 추가하지는 않습니다. **발표에서 "다음 단계"로 말할 재료**로 씁니다.

---

## 4. 운영 이벤트 (Could — 기록하지 않음)

| 이벤트 | 왜 하지 않는가 |
|---|---|
| `stock_ambiguous` | 화면에 후보가 뜨는 것으로 충분히 관찰됩니다 |
| `order_rejected_market_closed` | `order_rejected`의 `reason`으로 구분됩니다 |
| `order_rejected_insufficient_funds` | 동일 |
| `page_viewed` | 사용자 추적입니다. 개인정보 취급 책임만 늘어납니다 |
| `duplicate_order_blocked` | 4일 표본에서 의미 있는 수가 나오지 않습니다 |

**이벤트를 12개로 제한합니다.** 프로젝트 2에서 20개 이상을 나열했지만, 실제로 발표에서 쓰는 것은 5개 이하입니다. 기록 코드를 늘리는 것은 개발 시간을 늘리는 일입니다.

---

## 5. 기록 방식

```ts
// lib/events.ts
export async function logEvent(
  name: string,
  category: 'domain' | 'operation',
  payload?: Record<string, unknown>,
  orderId?: number,
) { /* insert into event_logs, 실패해도 throw 하지 않음 */ }
```

### 🔴 이벤트 기록 실패가 본 기능을 막으면 안 됩니다

```
❌ await logEvent(...)  →  실패하면 주문이 실패함
✅ logEvent(...).catch(() => {})  →  실패해도 주문은 진행됨
```

**이벤트는 관찰 장치이지 업무 로직이 아닙니다.** 관찰 장치 때문에 주문이 실패하면 본말이 전도됩니다.

> ⚠️ 단, 서버리스에서 `await` 없이 던진 비동기 작업은 **응답 반환 후 종료될 수 있습니다.** Vercel에서는 `waitUntil`을 쓰거나, 응답 직전에 `await`하되 `try/catch`로 감쌉니다. **후자를 채택합니다** (구현이 단순합니다).

---

## 6. `payload`에 넣지 않는 것

| 넣지 않는 것 | 이유 |
|---|---|
| KIS 계좌번호 | 개인정보 |
| 접근토큰 | 자격증명 |
| AI 응답 전문 | 용량. 생성 사실만 남깁니다 |
| `reason_memo` 원문 | 🔴 사용자가 쓴 문장. `rationales`에만 두고 로그에는 `has_memo`(boolean)만 |
| IP·User-Agent | 수집하지 않습니다 |

> 🔴 **발표 전 `event_logs`를 한 번 눈으로 훑습니다.** `select payload from event_logs limit 50`으로 계좌번호·토큰이 섞이지 않았는지 확인합니다. ([[../05_Scope/02_definition_of_done|완료 기준]])

---

## 7. 발표에서 쓸 문장 (미리 정해 둡니다)

```
"4일 동안 주문 N건을 넣었고, 그 N건 전부에 판단 근거가 붙어 있습니다.
 근거를 고르지 않으면 주문 버튼이 눌리지 않게 만들었기 때문입니다.
 그중 '그냥 감'이 M건이었습니다. 이 숫자를 줄이는 것이 다음 목표입니다."
```

숫자는 [[01_data_structure|데이터 구조]] 9절의 측정 SQL에서 나옵니다.

---

## 관련 문서

- [[01_data_structure|데이터 구조]]
- [[../02_Domain/03_workflow|업무 흐름]]
- [[../05_Scope/02_definition_of_done|완료 기준]]
