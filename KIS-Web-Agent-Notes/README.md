# KIS 모의투자 웹 AI 에이전트 — 기획 노트

> 프로젝트 3 :: 나만의 AI Agent 웹 서비스
> 서비스명 **왜샀어 (WhyBuy)**

- 작성일: 2026-08-06
- 개발 기간: **2026-08-06(목) ~ 08-09(일), 4일**
- 발표일: 2026-08-10(월)
- 기반 문서: `plan/KIS-Agent-Notes` (프로젝트 2, n8n·텔레그램 기획서)

---

## 한 줄 요약

```
모의투자 초보자가 "왜 샀는지"를 주문 직전에 반드시 적게 하고,
그 근거들을 한 화면에서 되돌아보게 만드는 웹 서비스입니다.
```

---

## 문서 지도

| 폴더 | 문서 | 내용 |
|---|---|---|
| 01_Baseline | [[01_Baseline/01_project_statement\|프로젝트 한 문장]] | 목적·성공 기준·웹 전환 이유 |
| | [[01_Baseline/02_project_baseline\|프로젝트 기준선]] | 사실·가정·제약·범위 초안 |
| 02_Domain | [[02_Domain/01_domain_elements\|도메인 요소]] | 엔티티와 화면 매핑 |
| | [[02_Domain/02_user_roles\|사용자 역할]] | Google 로그인 + 사용자별 가상 예산 |
| | [[02_Domain/03_workflow\|정상·예외 업무 흐름]] | 화면 흐름과 예외 12종 |
| 03_Data_Event | [[03_Data_Event/01_data_structure\|데이터 구조]] | Supabase 테이블 6개 |
| | [[03_Data_Event/02_data_sources\|데이터 소스]] | KIS·Gemini·Supabase |
| | [[03_Data_Event/03_event_catalog\|이벤트 카탈로그]] | 측정용 이벤트 정의 |
| 04_Architecture | [[04_Architecture/01_data_flow\|데이터 흐름]] | 요청 단위 시퀀스 |
| | [[04_Architecture/02_architecture\|아키텍처]] | Next.js·Vercel·Supabase 구성 |
| 05_Scope | [[05_Scope/01_mvp_scope\|MVP 범위와 우선순위]] | MoSCoW·시간 배분 |
| | [[05_Scope/02_definition_of_done\|완료 기준]] | 요구사항 대조 체크리스트 |
| 06_WBS | [[06_WBS/01_wbs\|WBS]] | 작업 분해와 견적 |
| | [[06_WBS/02_milestones\|4일 마일스톤과 위험]] | 🔴 **핵심 문서** |
| 07_Submit | [[07_Submit/01_readme_draft\|README 초안]] | 제출용 |
| | [[07_Submit/02_scope_reduction\|범위 축소 설명서]] | 🔴 REQ-01 필수 제출물 |

---

## 지금 바로 볼 것

1. **오늘 무엇을 하는가** → [[06_WBS/02_milestones|4일 마일스톤]] Day 1
2. **왜 웹으로 옮겼는가** → [[01_Baseline/01_project_statement|프로젝트 한 문장]] 4절
3. **무엇을 뺐는가** → [[07_Submit/02_scope_reduction|범위 축소 설명서]]

---

## 🔴 이 프로젝트를 지배하는 제약 3가지

| # | 제약 | 결과 |
|---|---|---|
| 1 | **거래일이 Day 1·2뿐** (Day 3·4는 주말 휴장) | 주문 검증과 녹화를 8/7(금) 15:30 안에 끝내야 합니다 |
| 2 | **Day 1이 반나절** (오늘 오전 소진) | 실 가용 시간이 32h가 아니라 약 28h입니다 |
| 3 | **Vercel은 고정 IP가 없음** | KIS 앱키의 접근 제한 여부를 Day 1 첫 작업으로 확인해야 합니다 |
