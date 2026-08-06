# 데이터 구조

- 작성일: 2026-08-06
- 저장소: Supabase (PostgreSQL)
- 선행 문서: `plan/KIS-Agent-Notes/03_Data_Event/01_data_structure`

---

## 0. 테이블 6개

| # | 테이블 | 역할 | 프로젝트 2 대비 |
|---:|---|---|---|
| 1 | `stocks` | 종목 마스터 | 동일 |
| 2 | `orders` | 주문 | **단순화** (컬럼 4개 감소, `user_id` 추가) |
| 3 | `rationales` | 판단 근거 | 동일 |
| 4 | `kis_tokens` | KIS 토큰 캐시 | 🆕 **신규** |
| 5 | `event_logs` | 이벤트 기록 | 동일 |
| 6 | `user_wallets` | 사용자별 가상 예산 | 🆕 **신규** |
| — | ~~`conversation_context`~~ | ~~대화 맥락~~ | 🗑️ **삭제** |

**REQ-03은 최소 1개 테이블을 요구합니다.** 6개는 필요해서 6개이고, 더 늘리지 않습니다.

> 🔴 **`user_wallets`가 신규로 늘어난 이유**: 계좌를 공개하되 소유자 패스코드로 막는 대신, **Google 로그인 + 사용자별 가상 예산으로 실제 주문을 허용**하기로 했습니다. 자세한 배경은 [[../02_Domain/02_user_roles|사용자 역할]] 1절을 참고합니다.

---

## 1. `stocks` — 종목 마스터

```sql
create table stocks (
  stock_code  varchar(6) primary key,
  stock_name  text not null,
  market      text not null,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index stocks_name_idx on stocks (stock_name);
```

| 컬럼 | 설명 |
|---|---|
| `stock_code` | `005930` |
| `stock_name` | `삼성전자` |
| `market` | `KOSPI` / `KOSDAQ` |
| `is_active` | 조회·주문 대상 여부 |

### 🔴 범위 제한: 코스피 상위 100종목

전체 상장 종목을 적재하면 준비 시간이 늘어납니다. 100종목이면 시연에 충분하고, 확대는 `Could`입니다.

**적재 방법**: 종목 목록 CSV를 만들어 Supabase 대시보드에서 Import합니다. 코드로 적재 스크립트를 만들지 않습니다. **1회성 작업에 스크립트를 쓰면 시간이 배로 듭니다.**

### 종목명 검색

```
사용자 입력 "삼성" → ilike '%삼성%' → 여러 건 → 후보 제시 (예외 2.2)
```

**부분 일치를 허용합니다.** 사용자가 정확한 종목명을 외우고 있다고 가정하지 않습니다.

---

## 2. `orders` — 주문

```sql
create table orders (
  id              bigserial primary key,
  user_id         uuid not null references user_wallets(user_id),
  stock_code      varchar(6) not null references stocks(stock_code),
  stock_name      text not null,
  side            text not null default 'buy',
  qty             integer not null check (qty > 0),
  expected_price  integer not null,
  expected_amount bigint not null,
  status          text not null default 'requested',
  order_no        text,
  reject_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index orders_created_idx on orders (created_at desc);
create index orders_user_idx on orders (user_id);
```

> `user_id`가 회고 화면(`/journal`)에서 "내 주문만" 필터링하는 기준이 됩니다.

### 프로젝트 2에서 삭제한 컬럼

| 삭제 | 이유 |
|---|---|
| `chat_id` | 텔레그램 사용자 식별자. 웹에는 없습니다 |
| `price` | 시장가 주문만 지원하므로 항상 `NULL`이었습니다. `expected_price`가 대신합니다 |
| `expires_at` | 대기 상태가 없으므로 만료 대상이 없습니다 |

> 🔴 **프로젝트 2의 `chat_id` 표현식 버그가 원천적으로 사라졌습니다.** 그 버그는 n8n 표현식이 평가되지 않아 생긴 것이었습니다. Next.js에서는 변수를 그대로 넘기므로 발생하지 않습니다.

### `status` 값 — 2개

| 값 | 의미 |
|---|---|
| `submitted` | KIS에 접수됨 |
| `rejected` | 사전 검증 실패 또는 KIS 거부 |

`requested`는 KIS 호출 직전의 순간 상태입니다. 정상적으로는 화면에 보이지 않습니다. 남아 있다면 서버가 KIS 호출 중 죽은 것이므로 **디버깅 신호**로 씁니다.

### 🔴 `stock_name`을 중복 저장하는 이유

`stocks`를 조인하면 얻을 수 있는 값이지만 저장합니다.

**회고 화면은 "그때 무엇을 샀는지"를 보여줍니다.** 종목명이 바뀌거나 상장폐지되어 `stocks`에서 사라져도 과거 기록은 그대로 남아야 합니다. 정규화보다 **기록의 불변성**을 우선합니다.

### 🔴 `expected_price`가 이 프로젝트의 핵심 컬럼입니다

시장가 주문이므로 실제 체결가는 알 수 없습니다. 하지만 **"내가 68,000원을 보고 저평가라고 판단했다"는 사실**이 없으면 회고가 성립하지 않습니다.

```
회고 화면:  당시 68,000원 (저평가 판단)  →  현재 71,200원  (+4.7%)
```

이 한 줄이 흐름 E의 전부이고, `expected_price` 없이는 만들 수 없습니다.

### 중복 주문 방지

```sql
-- 60초 내 동일 주문 조회로 처리 (인덱스 제약 대신 애플리케이션 검사)
select id from orders
where stock_code = $1 and qty = $2
  and created_at > now() - interval '60 seconds'
limit 1;
```

프로젝트 2는 부분 유니크 인덱스를 썼습니다. 대기 상태가 있어 동시 실행이 실제로 발생했기 때문입니다. 웹에서는 **버튼 비활성화가 1차 방어**이므로 DB 제약까지 걸 필요가 없습니다. 걸면 오히려 정상적인 연속 주문이 막힙니다.

---

## 3. `rationales` — 판단 근거

**이 프로젝트의 성공 기준을 담는 테이블입니다.**

```sql
create table rationales (
  id           bigserial primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  reason_type  text not null,
  reason_memo  text,
  created_at   timestamptz not null default now()
);
create index rationales_order_idx on rationales (order_id);
```

### `reason_type` 선택지 6개

| 값 | 화면 표시 |
|---|---|
| `undervalued` | 저평가라고 판단 |
| `earnings` | 실적이 좋아짐 |
| `industry` | 업황이 좋아 보임 |
| `news` | 뉴스나 이슈를 봄 |
| `dividend` | 배당을 기대 |
| `gut` | 그냥 감 |

> **`그냥 감`을 넣은 이유**: 없으면 사용자가 아무거나 고릅니다. 그러면 데이터가 오염되고 측정값을 믿을 수 없게 됩니다. 정직한 선택지를 주면 `gut` 비율 자체가 지표가 됩니다. **이 프로젝트의 목적은 `gut` 비율을 줄이는 것입니다.**

### 거부된 주문의 근거도 남깁니다

`orders.status = 'rejected'`여도 `rationales` 행을 삭제하지 않습니다. **사용자가 근거를 만들었다는 사실은 유효**합니다.

---

## 4. `user_wallets` — 사용자별 가상 예산 🆕

### 🔴 왜 이 테이블이 생겼습니까?

REQ-04는 공개 URL을 요구하지만, 이 서비스는 **KIS 모의계좌 1개**에 실제로 주문을 넣습니다. 누구나 같은 계좌에 접근하면 누군가 계좌를 소진시킬 수 있습니다.

**정식 서비스라면 계좌를 여러 개 개설해 사용자마다 배정합니다.** 이번 4일 MVP는 계좌가 1개뿐이므로, 실제 계좌를 나누는 대신 **DB 안에서 가상으로 예산을 나눕니다.**

```sql
create table user_wallets (
  user_id          uuid primary key references auth.users(id),
  allocated_amount integer not null default 5000000,
  created_at       timestamptz not null default now()
);
```

| 컬럼 | 설명 |
|---|---|
| `user_id` | Supabase Auth의 `auth.users.id`. Google 로그인으로 발급되는 실제 계정 UUID |
| `allocated_amount` | 이 사용자가 쓸 수 있는 가상 예산. 기본 500만원 |

### 행 생성 시점

**첫 주문 시도 시 `user_id`가 테이블에 없으면 upsert로 행을 만들고 기본 예산을 지급합니다.** 로그인 자체(회원가입)만으로는 행을 만들지 않습니다 — 로그인만 하고 주문은 안 하는 방문자까지 챙길 이유가 없습니다.

### 예산 소진 계산

저장된 잔여 예산 컬럼을 따로 두지 않습니다. 대신 매 주문마다 다시 계산합니다.

```sql
select coalesce(sum(expected_amount), 0) as spent
from orders
where user_id = $1 and status = 'submitted';
```

`allocated_amount - spent`가 남은 예산입니다. **컬럼으로 캐시하지 않는 이유**: 캐시된 값과 실제 주문 합계가 어긋나는 사고를 원천 차단합니다. 사용자 수가 적은 4일 프로젝트에서는 매번 계산해도 성능 문제가 없습니다.

### 이 테이블과 실제 계좌 예수금의 관계

| 검사 | 무엇을 지키는가 |
|---|---|
| `user_wallets` 기반 검사 | **사용자 1명이 계좌를 몰아 쓰는 것**을 막음 |
| KIS 실시간 예수금 조회 (기존 예외 2.5) | **계좌 전체 잔액**이 실제로 남아 있는지 확인 |

**두 검사는 순서대로 실행되며 서로를 대체하지 않습니다.** [[../02_Domain/03_workflow|업무 흐름]] 흐름 D 참고.

---

## 5. `kis_tokens` — 토큰 캐시 🆕

### 🔴 왜 프로젝트 2의 원칙을 뒤집습니까?

프로젝트 2의 데이터 구조 문서는 이렇게 썼습니다.

> KIS 접근토큰: n8n Credential이 관리합니다. DB에 두면 유출 위험이 커집니다.

**실행 환경이 바뀌어 이 원칙이 성립하지 않게 되었습니다.**

| | n8n | Vercel Route Handler |
|---|---|---|
| 프로세스 | 계속 떠 있음 | 요청마다 새로 뜸 |
| 메모리 | 공유됨 | 공유 안 됨 |
| 토큰 보관 | Credential에 유지 | **보관할 곳이 없음** |

캐시하지 않으면 **화면을 새로고침할 때마다 KIS에 토큰 발급을 요청**하게 됩니다. KIS는 토큰 발급 호출을 제한하므로 곧 차단되고, 그 시점은 **발표 당일 시연 중일 수 있습니다.**

```sql
create table kis_tokens (
  id            smallint primary key default 1 check (id = 1),
  access_token  text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
```

`id`를 `1`로 고정한 이유: 토큰은 항상 1개입니다. 행이 여러 개 생겨 어느 것이 최신인지 헷갈리는 상황을 **스키마 수준에서 차단**합니다.

### 유출 위험에 대한 대응

| 대응 | 내용 |
|---|---|
| RLS | `kis_tokens`에 **RLS를 켜고 정책을 만들지 않습니다.** anon key로는 읽을 수 없습니다 |
| 접근 경로 | Route Handler에서 서버 전용 클라이언트로만 접근 |
| 만료 여유 | `expires_at`을 KIS 응답값보다 **10분 이르게** 저장합니다 |

> 🔴 **만료 여유 10분이 없으면 "방금까지 됐는데 지금 안 되는" 현상이 발생합니다.** 프로젝트 2에서도 같은 대응을 했습니다.

### 🔴 반드시 테스트할 경로

```
expires_at을 강제로 과거로 바꾼 뒤 화면을 새로고침한다
→ 재발급이 일어나고 화면이 정상 표시되어야 한다
```

이 경로는 **24시간 안에 개발하면 자연히 드러나지 않습니다.** 발표 당일 아침에 처음 터집니다. Day 1에 강제로 테스트합니다.

---

## 6. `event_logs` — 이벤트 기록

```sql
create table event_logs (
  id             bigserial primary key,
  event_name     text not null,
  event_category text not null,
  order_id       bigint,
  payload        jsonb,
  occurred_at    timestamptz not null default now()
);
create index event_logs_name_idx on event_logs (event_name, occurred_at desc);
```

`payload`가 `jsonb`인 이유: 이벤트마다 담을 내용이 다릅니다. `stock_resolution_failed`는 입력값을, `order_rejected`는 거부 사유를 담습니다.

정의는 [[03_event_catalog|이벤트 카탈로그]]에 있습니다.

---

## 7. RLS 정책

Supabase Auth를 쓰므로 **`auth.uid()`로 실제 신원을 확인할 수 있습니다.** 익명 쿠키 방식일 때는 신원을 증명할 방법이 없어 전면 차단 후 Route Handler만 믿는 구조였지만, 로그인 도입으로 RLS 자체가 "내 것만" 규칙을 강제할 수 있게 되었습니다.

| 테이블 | RLS | 정책 |
|---|---|---|
| `stocks` | on | `select` 전체 허용 (공개 데이터) |
| `orders` | on | `select`·`insert` — `auth.uid() = user_id`인 행만 |
| `rationales` | on | `select`·`insert` — 연결된 `orders.user_id = auth.uid()`인 행만 (서브쿼리) |
| `user_wallets` | on | `select` — `auth.uid() = user_id`인 행만. **`insert`·`update`는 정책 없음(서버 전용)** |
| `kis_tokens` | on | 🔴 **정책 없음 (전면 차단)** |
| `event_logs` | on | 🔴 **정책 없음 (전면 차단)** |

```sql
create policy "select own orders" on orders
  for select using (auth.uid() = user_id);
create policy "insert own orders" on orders
  for insert with check (auth.uid() = user_id);

create policy "select own rationales" on rationales
  for select using (
    exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );
create policy "insert own rationales" on rationales
  for insert with check (
    exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );

create policy "select own wallet" on user_wallets
  for select using (auth.uid() = user_id);
```

**모든 쓰기는 여전히 Route Handler를 통합니다.** 다만 이제 Route Handler가 요청자의 로그인 세션(쿠키의 Supabase Auth 토큰)을 그대로 사용해 Supabase를 호출하므로, DB가 `auth.uid()`로 신원을 한 번 더 검증합니다. **사전 검증(장 시간·예수금·가상 예산)은 여전히 서버 로직이 담당**하고, RLS는 그 결과가 "본인 이름으로만" 기록되도록 하는 마지막 방어선입니다.

> ⚠️ `orders`·`rationales`를 본인 것만 보이게 좁힌 이유: 익명 쿠키 시절에는 개인정보가 없다는 이유로 전체 공개를 검토했지만, 이제는 실제 계정과 묶이므로 **다른 사용자의 매매 내역이 노출되면 안 됩니다.**

> ⚠️ `user_wallets`에 `insert`·`update` 정책을 두지 않는 이유: 브라우저가 직접 쓸 수 있으면 자기 예산을 조작할 수 있습니다. 지급·차감 계산은 Route Handler(서버 전용 로직)만 수행합니다.

---

## 8. 저장하지 않는 데이터

| 데이터 | 이유 |
|---|---|
| 예수금·보유종목·수익률 | 실시간으로 변합니다 |
| 현재가·등락률 | 동일 |
| KIS 계좌번호·앱키 | 환경변수. DB·화면·문서·발표자료에 남기지 않습니다 |
| Gemini 생성 문장 | 매번 새로 생성합니다. 생성 사실만 이벤트로 남깁니다 |
| 방문자 IP·브라우저 정보 | 수집하지 않습니다. 수집하면 개인정보 처리 책임이 생깁니다 |

---

## 9. 전체 관계

```
user_wallets ──< orders ──< rationales
stocks ─────────────< orders
                        │
                        └──< event_logs (order_id, 선택적)

kis_tokens  (독립. 어디와도 연결되지 않음)
```

---

## 10. 측정 SQL

발표에서 쓸 숫자를 미리 정의합니다.

```sql
-- 1. 근거 기록률 (목표 100%)
select
  count(*) filter (where r.id is not null)::float / nullif(count(*), 0) as rate
from orders o left join rationales r on r.order_id = o.id
where o.status in ('submitted', 'rejected');

-- 2. "그냥 감" 비율
select
  count(*) filter (where reason_type = 'gut')::float / nullif(count(*), 0) as gut_rate
from rationales;

-- 3. 근거 유형 분포
select reason_type, count(*) from rationales group by 1 order by 2 desc;

-- 4. 메모 작성률
select
  count(*) filter (where coalesce(reason_memo, '') <> '')::float
  / nullif(count(*), 0) as memo_rate
from rationales;
```

> ⚠️ **표본이 작다는 것을 인정합니다.** 4일 동안 본인과 테스트 사용자 2명이 만든 데이터는 통계가 아닙니다. 발표에서는 **비율이 아니라 실수(`6건 중 4건`)로 말합니다.**

---

## 관련 문서

- [[02_data_sources|데이터 소스]]
- [[03_event_catalog|이벤트 카탈로그]]
- [[../02_Domain/03_workflow|업무 흐름]]
- [[../04_Architecture/02_architecture|아키텍처]]
