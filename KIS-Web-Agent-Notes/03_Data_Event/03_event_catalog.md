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

## 2. 도메인 이벤트 (계획 7개 → 🔄 실제 6개 + 신규 1개)

| # | 이벤트 | 발생 시점 | `payload` |
|---:|---|---|---|
| 1 | `account_diagnosed` | AI-1이 계좌를 해석함 | `{ deposit, total_eval, profit_rate }` 🔄 `deposit`은 실제 계좌 예수금이 아니라 **이 사용자의 남은 가상 예산**입니다. 계좌 화면이 공용 KIS 잔고 대신 로그인 사용자가 이 서비스로 주문한 종목 기준으로 바뀌었기 때문입니다 (2026-08-06, [[../02_Domain/03_workflow|업무 흐름]] 흐름 B). |
| 2 | `quote_retrieved` | 종목 시세를 조회함 | `{ stock_code, price, change_rate }` |
| 3 | `order_submitted` | KIS에 주문이 접수됨 | `{ stock_code, qty, expected_price, order_no }` 🔄 **`side`·`order_type` 추가** (매수/매도, 시장가/지정가 구분) |
| 4 | `order_rejected` | 주문이 거부됨 | `{ stock_code, qty, reason }` 🔄 **`side` 추가** |
| 5 | `rationale_recorded` | 판단 근거가 저장됨 | `{ reason_type, has_memo }` |
| 6 | `journal_reviewed` | AI-2 회고 코멘트를 생성함 | `{ order_count, gut_ratio }` |
| 7 | ~~`term_explained`~~ | ~~AI-3가 용어를 설명함 (Should)~~ | ❌ **미구현** — AI-3 자체를 만들지 않았습니다 |
| 🆕 | `order_cancelled` | 대기중인 지정가 주문을 사용자가 취소함 | `{ order_id, cancelled_qty }` |

> ❌ **7번은 정의만 남고 코드에 없습니다.** AI-3(용어 설명)이 Should Have에 머물러 Day 2의 다른 기능들에 밀렸기 때문입니다. **이벤트만 먼저 정의해두는 것이 무해해 보였지만, 결과적으로 "카탈로그에는 있는데 DB에는 0건"인 항목이 생겼습니다.**
>
> 🆕 **`order_cancelled`는 계획에 없던 도메인 이벤트입니다.** 지정가 주문이 들어오면서 "사용자가 주문을 무른다"는 사건이 처음 생겼습니다. 취소는 사용자에게 의미 있는 사건이므로 운영이 아니라 **도메인**으로 분류했습니다.

### 🔴 5번과 6번이 성공 기준을 담습니다

| 이벤트 | 측정하는 것 |
|---|---|
| `rationale_recorded` | 근거를 실제로 적었는가 (기록률) |
| `journal_reviewed` | 회고 화면을 실제로 썼는가 (**회고가 일어났는가**) |

6번이 특히 중요합니다. 회고 화면을 만들어 놓고 **아무도 안 눌렀다면** 이 프로젝트의 가정은 검증되지 않은 것입니다. 발표에서 그렇게 말해야 합니다.

---

## 3. 운영 이벤트 (계획 5개 → 🔄 실제 4개 + 신규 2개)

| # | 이벤트 | 발생 시점 | `payload` |
|---:|---|---|---|
| 8 | `token_refreshed` | KIS 토큰을 재발급함 | `{ expires_at }` |
| 9 | `token_refresh_failed` | 🔴 재발급 실패 | ~~`{ status, message }`~~ 🔄 실제는 `{ status, **body** }` (KIS 응답 원문 앞 500자) |
| 10 | `llm_call_failed` | Gemini 호출 실패·타임아웃 | `{ purpose, error }` |
| 11 | ~~`stock_resolution_failed`~~ | ~~종목을 찾지 못함~~ | ❌ **미구현** — `app/api/stocks/route.ts`는 빈 결과를 그냥 반환합니다 |
| 12 | `order_rejected_budget_exceeded` | 사용자의 가상 예산 초과 | `{ user_id, requested_amount, remaining }` |
| 🆕 | `order_rejected_oversell` | 보유 수량보다 많이 팔려고 함 | `{ user_id, stock_code, requested_qty, sellable }` |
| 🆕 | `order_fill_checked` | 사용자가 [체결 확인]을 눌러 KIS에 조회함 | `{ order_id, filled_qty, remaining_qty }` |

> 🆕 **뒤의 2개는 매도·지정가와 함께 생긴 이벤트입니다.** `order_rejected_oversell`은 매도에만 있는 거부 사유라 `order_rejected_budget_exceeded`와 나란히 두었고(매수는 예산, 매도는 보유 수량이 한도), `order_fill_checked`는 체결 확인이 **사용자 트리거**라서 얼마나 실제로 쓰이는지 봐야 의미가 있습니다.

### 9번을 최우선으로 보는 이유

토큰 재발급 실패는 **화면상으로는 "잠시 후 다시 시도해주세요"로만 보입니다.** 원인이 무엇인지 알 방법이 이 이벤트뿐입니다. 발표 당일 시연이 안 될 때 30초 안에 원인을 판단해야 합니다.

### ~~11번이 프롬프트 개선의 재료입니다~~ ❌ 만들지 않아 재료가 없습니다

~~사용자가 어떤 표현으로 종목을 찾는지 `input`에 쌓입니다. `삼전`, `SK하닉` 같은 줄임말이 많으면 별칭 컬럼을 추가할 근거가 됩니다.~~

> ❌ **이 절의 계획은 통째로 성립하지 않습니다.** `stock_resolution_failed`를 구현하지 않아 `input`이 하나도 쌓이지 않았습니다. 종목 별칭(`삼전` → 삼성전자)은 Could Have에 남아 있는데, **그 근거가 될 데이터를 모으는 장치를 안 만든 것**입니다.
>
> 🔴 **이게 이번에 배운 것입니다.** "나중에 판단할 재료를 남긴다"는 이벤트는 **기능이 아니라서 우선순위에서 가장 먼저 밀립니다.** 화면에 아무것도 안 보이므로 빠뜨려도 티가 안 나고, 그래서 정작 판단할 시점에 데이터가 없습니다. 8/7에 "왜 검색이 안 되냐"는 질문을 받았을 때도 로그가 아니라 **사용자의 말**로 알았습니다.
>
> 별칭은 여전히 "다음 단계"로 말할 수 있지만, **근거는 이벤트 데이터가 아니라 일화 하나뿐**이라고 정직하게 말해야 합니다.

---

## 4. ~~운영 이벤트 (Could — 기록하지 않음)~~ 🔄 3개는 실제로 기록하고 있습니다

| 이벤트 | 왜 하지 않는다고 했나 | 🔄 실제 |
|---|---|---|
| `stock_ambiguous` | 화면에 후보가 뜨는 것으로 충분히 관찰됩니다 | ✅ 계획대로 기록 안 함 |
| ~~`order_rejected_market_closed`~~ | ~~`order_rejected`의 `reason`으로 구분됩니다~~ | 🔄 **기록 중** (DB 2건) |
| ~~`order_rejected_insufficient_funds`~~ | ~~동일~~ | 🔄 **기록 중** |
| `page_viewed` | 사용자 추적입니다. 개인정보 취급 책임만 늘어납니다 | ✅ 계획대로 기록 안 함 |
| ~~`duplicate_order_blocked`~~ | ~~4일 표본에서 의미 있는 수가 나오지 않습니다~~ | 🔄 **기록 중** (DB 1건) |

> 🔄 **왜 뒤집혔는가.** 셋 다 `/api/order`의 거부 분기를 짜다가 **그 자리에서 한 줄 더 쓰는 게 자연스러워서** 넣었습니다. 계획을 검토하고 뒤집은 게 아니라, 계획을 보지 않고 넣었습니다.
>
> **결과적으로는 잘한 쪽입니다.** `order_rejected`의 `reason` 문자열을 파싱해 구분하는 것보다 이벤트 이름이 갈라져 있는 편이 집계가 쉽고, `duplicate_order_blocked`는 "4일 표본에서 의미 없다"던 예상과 달리 **실제로 1건이 찍혀 중복 방어가 작동한다는 증거**가 됐습니다.
>
> ⚠️ **다만 카탈로그가 3일 동안 코드와 반대로 적혀 있었습니다.** 이 문서만 보고 "이 이벤트는 없다"고 판단했다면 틀렸을 것입니다.

### 🔄 최종 집계 — 계획 12개 → 실제 15개

| | 개수 | 내역 |
|---|---:|---|
| 계획 (Must) | 12 | 도메인 7 + 운영 5 |
| 미구현 | −2 | `term_explained`(AI-3 자체가 없음), `stock_resolution_failed` |
| 계획엔 "안 한다"였는데 기록 중 | +3 | `order_rejected_market_closed`, `order_rejected_insufficient_funds`, `duplicate_order_blocked` |
| 계획에 아예 없던 신규 | +2 | `order_rejected_oversell`, `order_fill_checked` |
| 계획에 아예 없던 신규 (도메인) | +1 | `order_cancelled` |
| **코드에 정의된 이름** | **15** | 이 중 DB에 실제 적재된 것은 **12종** |

~~**이벤트를 12개로 제한합니다.**~~ 🔄 **숫자는 우연히 12개 근처로 유지됐지만, 제한이 작동해서가 아니라 빠진 만큼 늘어난 결과입니다.** "발표에서 실제로 쓰는 것은 5개 이하"라는 판단 자체는 지금도 맞습니다 — 발표에 쓰는 것은 `rationale_recorded`·`journal_reviewed`·`order_submitted` 정도입니다.

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

**이벤트는 관찰 장치이지 업무 로직이 아닙니다.** 관찰 장치 때문에 주문이 실패하면 본말이 전도됩니다.

서버리스에서 `await` 없이 던진 비동기 작업은 **응답 반환 후 종료될 수 있습니다.** 그래서 `await`하되 실패를 삼키는 쪽을 택했습니다.

🔄 **다만 삼키는 위치가 계획과 다릅니다.**

```
계획: logEvent(...).catch(() => {})     ← 호출부마다 catch
실제: await logEvent(...)               ← 호출부는 그냥 await
      └ logEvent 내부에 try/catch       ← 함수가 절대 throw하지 않음
```

**호출부 17곳이 전부 그냥 `await logEvent(...)`입니다.** 계획 문서의 `❌ await logEvent(...)` 예시와 겉모습이 같아서 오해하기 쉬운데, **`logEvent`가 내부에서 절대 throw하지 않으므로 위험은 없습니다.** 호출부마다 `.catch()`를 붙이는 것보다 함수 하나가 책임지는 편이 빠뜨릴 여지가 없다고 봤습니다.

### ⚠️ `orderId` 인자를 아무도 쓰지 않습니다

`logEvent`의 4번째 인자 `orderId`는 `event_logs.order_id` 컬럼에 들어가라고 만들었는데, **호출부 17곳 전부 넘기지 않습니다.** DB의 `event_logs` 행 전체가 `order_id IS NULL`입니다.

정작 주문과 엮인 이벤트(`order_cancelled`·`order_fill_checked`)는 `payload` 안에 `order_id`를 넣는 방식으로 우회하고 있습니다. **컬럼과 payload 중 어디에 넣을지 정해두지 않아 결과적으로 둘 다 어중간해졌습니다** — 컬럼은 비어 있고, 조인하려면 `payload->>'order_id'`를 캐스팅해야 합니다.

---

## 6. `payload`에 넣지 않는 것

| 넣지 않는 것 | 이유 |
|---|---|
| KIS 계좌번호 | 개인정보 |
| 접근토큰 | 자격증명 |
| AI 응답 전문 | 용량. 생성 사실만 남깁니다 |
| `reason_memo` 원문 | 🔴 사용자가 쓴 문장. `rationales`에만 두고 로그에는 `has_memo`(boolean)만 |
| IP·User-Agent | 수집하지 않습니다 |

**전수 확인 결과 이 원칙은 지켜졌습니다.** 계좌번호·토큰·메모 원문이 들어간 payload는 없고, 메모는 `has_memo` 불리언으로만 남습니다.

> ⚠️ **한 곳이 취지와 충돌할 수 있습니다.** `token_refresh_failed`가 KIS 응답 body를 앞 500자까지 그대로 싣습니다. 실패 원인을 30초 안에 판단하려고 넣은 것이고 현재 DB에 0건이라 실피해는 없지만, **KIS가 에러 응답에 무엇을 담을지는 이쪽이 통제할 수 없습니다.** 발표 전 확인 대상에 이 이벤트를 명시적으로 포함합니다.

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
