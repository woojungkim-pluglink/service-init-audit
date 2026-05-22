# 서비스개시 검증 대시보드 — 설계서

- 작성일: 2026-05-22
- 작성자: woojung.kim@pluglink.kr
- 상태: 설계 승인 후 구현 계획 작성 단계

## 1. 배경 및 목적

Pluglink 플링커넥트(connect.pluglink.kr)에서는 충전기 서비스개시가 두 가지 경로로 일어난다.

1. **예약 개시** — 과거 시점에 미래 일자로 개시일을 확정 → 개시일 도래 시 자동 전환. 슬랙 채널 `C026XGZE1GT`에 **매일 08:00 / 17:00 KST** 알림 발생.
2. **당일 개시** — 당일 즉시 서비스개시 처리. 슬랙 채널에 **매일 17:00 KST** 알림 발생.

서비스개시는 단순히 시스템 상태 전환만으로 끝나는 게 아니라, 아래 4가지가 **모두 정상**이어야 운영 사고가 없다. 현재는 PM(체셔/윤택/케이시)이 수기 또는 산발적으로 확인하고 있어 누락 위험이 크다.

| 검증 항목 | 현재 확인 방법 | 누락 시 영향 |
|---|---|---|
| 아파트측 공문 발송 | PM이 Gmail에서 cc 회신 확인 | 아파트와의 분쟁, 입주민 컴플레인 |
| 충전기 요금제 = 계약 합의안 | 플링커넥트 페이지 수기 비교 | 매출 손실 또는 약관 위반 |
| 충전기 상태 정상 전환 (사업개시/운영/사용가능) | 충전소 페이지 수기 확인 | 환경부 보조금 지급 지연 |
| 영차영차new BR열 동기화 | 시트 수기 입력 | 후속 프로세스(준공접수 등) 오류 |

본 대시보드는 위 4가지를 **매일 자동 검증**하여, 슬랙 알림 시각(08:00 / 17:00) 직후에 결과를 정적 웹 대시보드 + 슬랙 DM으로 제공한다.

## 2. 범위

### 포함
- 슬랙 채널 `C026XGZE1GT` 메시지에서 당일 서비스개시 충전소 식별
- 4종 검증 자동 실행 (Gmail / 플링커넥트 / 플링커넥트 / 영차영차new 시트)
- Vercel 정적 대시보드 (날짜 필터, 90일 보관)
- 슬랙 DM 요약 (테스트 단계 → 향후 충전소 알림 메시지 스레드 답글로 이전)
- Windows 작업 스케줄러 등록 (사용자 PC에서 실행)

### 제외 (향후 과제)
- GitHub Actions / Vercel cron으로 클라우드 이관 (토큰 갱신 자동화 후)
- 슬랙 알림 스레드 답글 자동화 (DM 안정화 후)
- VOC / 보조금 / 준공접수 단계와의 통합 대시보드

## 3. 시스템 아키텍처

```
┌─ Windows 작업 스케줄러 (사용자 PC) ─────────────────┐
│  08:30, 17:30 KST  →  node audit.js --slot={morning|evening}
└──────────────────────┬─────────────────────────────┘
                       ↓
        ┌─────────── audit.js (단일 진입점) ──────────┐
        │  1. discover.js                              │
        │     슬랙 C026XGZE1GT 채널 당일 슬롯 메시지     │
        │     → 충전소 링크 → projectId 목록            │
        │                                              │
        │  2. for each projectId (concurrency=3):      │
        │     ├ check_doc.js     (Gmail cc 검색)       │
        │     ├ check_rate.js    (플링커넥트 3단)       │
        │     ├ check_status.js  (충전소 하단 상태)     │
        │     └ check_sheet.js   (영차영차 BR열)        │
        │                                              │
        │  3. merge & write                            │
        │     data/YYYY-MM-DD-{morning|evening}.json   │
        │                                              │
        │  4. git add/commit/push                      │
        │     → Vercel 자동 배포                        │
        │                                              │
        │  5. notify.js → Slack DM 요약                │
        └──────────────────────────────────────────────┘
                       ↓
        ┌─── service-init-audit.vercel.app ───┐
        │  index.html (정적, Vanilla JS)      │
        │  ├ 좌측: 날짜 필터 (최근 90일)        │
        │  ├ 본문: 프로젝트 카드 그리드         │
        │  └ 카드: 4종 검증 신호등 + 상세 토글  │
        └─────────────────────────────────────┘
```

**핵심 설계 결정:**
- `audit.js` 단일 진입점 — 4개 체커는 require로 import되는 모듈
- 체커별 모듈 분리 — 각자 `async (project) => CheckResult` 시그니처, 단일 책임
- 하루 2번 실행 / 별도 JSON — 아침(`-morning.json`) / 저녁(`-evening.json`) 분리 추적
- Vercel은 정적 호스팅만 — 모든 연산은 로컬 PC, Vercel은 결과 JSON 서빙
- Playwright 인스턴스는 `audit.js`가 1개만 띄워서 체커들이 공유 (탭만 새로)

## 4. 실행 시간

| 슬롯 | 슬랙 알림 시각 | 검증 실행 시각 | 이유 |
|---|---|---|---|
| morning | 08:00 KST | **08:30 KST** | 메시지 도착·렌더 여유 30분 |
| evening | 17:00 KST | **17:30 KST** | 동일 |

## 5. 데이터 모델

매 실행마다 `data/YYYY-MM-DD-{slot}.json` 한 파일 생성.

```json
{
  "runAt": "2026-05-22T08:30:00+09:00",
  "slot": "morning",
  "sourceMessages": [
    {
      "ts": "1779404445.913559",
      "permalink": "https://pluglink.slack.com/archives/C026XGZE1GT/p1779404445913559",
      "stationLinks": ["https://connect.pluglink.kr/stations/12345"]
    }
  ],
  "projects": [
    {
      "projectId": "abc-uuid",
      "projectName": "OO아파트",
      "stationId": "12345",
      "stationName": "OO아파트 지하주차장",
      "initiatedAt": "2026-05-22",
      "chargerCount": 4,
      "checks": {
        "doc":    { "status": "...", "evidence": { ... }, "message": "..." },
        "rate":   { "status": "...", "evidence": { ... }, "message": "..." },
        "status": { "status": "...", "evidence": { ... }, "message": "..." },
        "sheet":  { "status": "...", "evidence": { ... }, "message": "..." }
      },
      "overall": "FAIL"
    }
  ],
  "summary": {
    "totalProjects": 5,
    "byOverall": { "PASS": 2, "WARN": 1, "FAIL": 2 },
    "byCheck": {
      "doc":    { "PASS": 4, "WARN": 0, "FAIL": 1, "SKIP": 0 },
      "rate":   { "PASS": 5, "WARN": 0, "FAIL": 0, "SKIP": 0 },
      "status": { "PASS": 3, "WARN": 1, "FAIL": 1, "SKIP": 0 },
      "sheet":  { "PASS": 4, "WARN": 0, "FAIL": 1, "SKIP": 0 }
    }
  },
  "errors": []
}
```

추가로 매니페스트 파일 `data/index.json` 유지:

```json
{
  "lastUpdated": "2026-05-22T17:30:00+09:00",
  "slots": [
    { "date": "2026-05-22", "slot": "morning", "file": "2026-05-22-morning.json", "summary": { ... } },
    { "date": "2026-05-22", "slot": "evening", "file": "2026-05-22-evening.json", "summary": { ... } }
  ]
}
```

### 상태값 정의

| 값 | 의미 |
|---|---|
| `PASS` | 정상 |
| `WARN` | 의심·부분이상 (일부 충전기만 점검중, BR열 날짜 1일 차이 등) |
| `FAIL` | 명확한 위반 (공문 못 찾음, 요금제 불일치, 시트 비어있음) |
| `SKIP` | 검증 불가 (네트워크/페이지 구조 변경 등 — `errors`에도 기록) |

`overall`은 4개 체크 중 가장 나쁜 상태로 결정. 우선순위: `FAIL > WARN > SKIP > PASS`.

## 6. 검증 체커 상세

### 6.1 `check_doc.js` — 공문 발송

**입력:** `{ projectName, stationName, address, initiatedAt }`
**출력:** `{ status, evidence: { matchedEmails[], queriedKeywords[] }, message }`

**알고리즘:**
1. Gmail MCP `search_threads` 호출
2. 쿼리: `from:(daeyeol.yang OR taekyoon.kim OR chunggeun.kim @pluglink.kr) cc:me after:{initiatedAt-30일}`
3. 결과 스레드 본문/제목에 `projectName`, `stationName`, `address` 중 하나라도 부분 매칭 시 후보
4. 판정:
   - 후보 ≥1 → `PASS`
   - 후보 0 but PM 발신 메일은 존재(cc:me 빠짐) → `WARN`
   - 후보 0 + PM 발신 메일도 없음 → `FAIL`

**PM 이메일 매핑** (`config/pm_emails.json`):
```json
{
  "양대열": { "nickname": "체셔",   "email": "daeyeol.yang@pluglink.kr" },
  "김택윤": { "nickname": "윤택",   "email": "taekyoon.kim@pluglink.kr" },
  "김충근": { "nickname": "케이시", "email": "chunggeun.kim@pluglink.kr" }
}
```

### 6.2 `check_rate.js` — 요금제 일치 + 특가합의서

**입력:** `{ projectId, stationId }`
**출력:** `{ status, evidence: { contractRateName, hasSpecialAgreementFile, appliedChargers[], projectChargers[], diff[] }, message }`

**알고리즘:**
1. Playwright로 connect.pluglink.kr 로그인 (기존 `pluglink-connect-login` 스킬 호출, `chrome_profile/` 재사용)
2. **프로젝트 페이지 → 계약탭:**
   - 합의 요금제명 텍스트 추출
   - "특가" 키워드 포함 시 → 첨부파일 영역에서 `.pdf`/`.png`/`.jpg` 1개 이상 존재 확인
3. **충전소 페이지 → 요금제탭:**
   - 위에서 얻은 요금제명 옆 "자세히" 클릭
   - 적용 충전기 deviceId 리스트 수집
4. **프로젝트 페이지 → 서비스개시 탭:**
   - 등록 충전기 deviceId 리스트 수집
5. 두 리스트 비교 → `diff`에 대칭 차집합 기록
6. 판정:
   - `diff == [] && (특가 아님 || 합의서 있음)` → `PASS`
   - 특가인데 합의서 없음 → `FAIL`
   - `diff != []` → `FAIL`

### 6.3 `check_status.js` — 충전기 상태 3종

**입력:** `{ stationId }`
**출력:** `{ status, evidence: { chargers[], abnormal[] }, message }`

**알고리즘:**
1. Playwright로 충전소 상세 페이지 진입 (세션 재사용)
2. **충전소 페이지 하단의 충전기 테이블** 스크래핑 — 각 행에서 `deviceId`, `사업개시상태`, `운영상태`, `사용상태` 추출
3. 정상 조건: `사업개시상태=='사업개시' && 운영상태=='운영' && 사용상태=='사용가능'`
4. 비정상 충전기를 `abnormal[]`에 누적
5. 판정:
   - 모두 정상 → `PASS`
   - 일부 비정상 → `WARN`
   - 전부 비정상 → `FAIL`

### 6.4 `check_sheet.js` — 영차영차new BR열 매칭

**입력:** `{ projectId, pluglinkInitDate }`
**출력:** `{ status, evidence: { rowNumber, brValue, mismatchKind, pluglinkInitDate }, message }`

**데이터 소스:** 영차영차new (Google Sheets ID: `18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI`, gid `300841532`)

**알고리즘:**
1. Playwright로 docs.google.com 로그인 세션 사용 → `gviz/tq?tqx=out:csv&gid=300841532` fetch
2. 시트의 프로젝트ID 열 (구현 시 컬럼 인덱스 확인 필요)을 키로 매칭
3. 해당 행 BR열(서비스개시일) 값 읽기
4. 판정:
   - `brValue == null` → `FAIL` (`mismatchKind: "MISSING"`)
   - `brValue == pluglinkInitDate` → `PASS`
   - 다름 → `FAIL` (`mismatchKind: "DATE_MISMATCH"`)
   - 행 자체가 없음 → `SKIP` + `errors`에 기록

## 7. 대시보드 UI

**URL:** `service-init-audit.vercel.app` (또는 토큰 부여 비공개 URL)

```
┌─────────────────────────────────────────────────────────────┐
│  서비스개시 검증 대시보드          [마지막 갱신: 17:31 KST]  │
├──────────┬──────────────────────────────────────────────────┤
│ 날짜 필터 │  2026-05-22  (목)                                │
│          │  ┌─ 오늘 요약 ──────────────────────────────────┐│
│ ▼ 5월    │  │  총 5건  ·  PASS 2  ·  WARN 1  ·  FAIL 2   ││
│  05-22 ●●│  │  공문 4/5  요금제 5/5  상태 4/5  시트 4/5   ││
│  05-21 ●●│  └────────────────────────────────────────────┘│
│  05-20 ● │                                                  │
│  ...    │  ┌─ ▼ 아침(8AM 알림) 슬롯 ──────────────────────┐│
│         │  │ [FAIL] OO아파트   서비스개시일: 2026-05-22   ││
│         │  │   📭 공문 FAIL    💰 요금제 PASS              ││
│         │  │   ⚙️  상태 WARN    📊 시트 FAIL                ││
│         │  │   ▼ 펼치기 → evidence 상세                    ││
│         │  └──────────────────────────────────────────────┘│
│         │                                                  │
│         │  ┌─ ▶ 저녁(5PM 알림) 슬롯 ──────────────────────┐│
│         │  │ [PASS] XX아파트  · [PASS] YY아파트            ││
│         │  └──────────────────────────────────────────────┘│
└──────────┴──────────────────────────────────────────────────┘
```

**컴포넌트:**
- **좌측 사이드바** — 최근 90일 날짜, 점(●)으로 슬롯 표시(아침/저녁), 클릭 시 본문 갱신
- **상단 요약 바** — 선택일의 4종 검증 통계
- **본문 카드 그리드** — 아침/저녁 슬롯을 접이식 섹션으로 분리
- **카드 펼치기** — `evidence` 표시:
  - 공문: 매칭된 메일 (Gmail 딥링크)
  - 요금제: 합의 요금제명 + diff 충전기 ID
  - 상태: 비정상 충전기 deviceId + 상태값
  - 시트: 행번호 + BR값 vs 플링커넥트 값

**기술 스택:**
- 순수 HTML + Vanilla JS (기존 `vercel-dashboard` 패턴)
- 빌드 단계 없음 — `index.html`이 `data/*.json` fetch
- 색상: PASS=초록, WARN=주황, FAIL=빨강

**필터·정렬:**
- 기본 정렬: 날짜순(오늘 우선)
- 카드 상단 토글: "FAIL/WARN만 보기"

## 8. 알림

### 8.1 현재 단계 (테스트)
- **Slack DM** to `NOTIFY_SLACK_USER_ID` (woojung.kim)
- 매 슬롯 실행 후 1건
- 내용:
  ```
  [2026-05-22 evening] 검증 완료
  총 5건 · PASS 2 · WARN 1 · FAIL 2
  공문 4/5 · 요금제 5/5 · 상태 4/5 · 시트 4/5

  FAIL 건:
   · OO아파트 (공문 FAIL, 시트 FAIL)
   · ZZ아파트 (요금제 FAIL)

  대시보드: service-init-audit.vercel.app/?date=2026-05-22&slot=evening
  ```

### 8.2 향후 단계
- 슬랙 채널 `C026XGZE1GT`의 **해당 충전소 알림 메시지에 스레드 답글**로 검증 결과 첨부
- `sourceMessages[].ts`를 이용해 `chat.postMessage`의 `thread_ts` 파라미터로 답글

## 9. 인증·시크릿 관리

### 디렉토리 구조

```
C:/Users/user/Documents/claude/service-init-audit/
├── audit.js
├── lib/
│   ├── discover.js
│   ├── check_doc.js
│   ├── check_rate.js
│   ├── check_status.js
│   ├── check_sheet.js
│   ├── playwright_session.js
│   └── notify.js
├── config/
│   ├── pm_emails.json        # 커밋
│   └── .env                  # gitignore
├── data/                     # vercel 빌드 포함
│   ├── index.json
│   ├── 2026-05-22-morning.json
│   └── 2026-05-22-evening.json
├── public/                   # vercel 정적
│   ├── index.html
│   └── app.js
├── chrome_profile/           # gitignore
├── logs/                     # gitignore, 90일 자동 정리
├── docs/superpowers/specs/
├── vercel.json
├── package.json
└── README.md
```

### 시크릿 (`config/.env`, gitignore)

```
SLACK_BOT_TOKEN=xoxb-...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
SHEET_GVIZ_COOKIE=...
DASHBOARD_DEPLOY_TOKEN=...
NOTIFY_SLACK_USER_ID=Uxxx
```

- 플링커넥트는 `chrome_profile/` 영구 디렉토리에 쿠키 보존 (한 번 수동 로그인)
- Google Sheets는 docs.google.com 로그인 세션을 Playwright로 재사용

## 10. 에러 처리 정책

| 실패 유형 | 동작 |
|---|---|
| 슬랙 메시지 0건 | 정상 종료, `projects: []` JSON 생성 (휴일 가능) |
| 플링커넥트 로그인 만료 | Slack DM 알림 + exit 2. 해당 슬롯은 빈 JSON. |
| Gmail 쿼리 실패 | `check_doc`만 `SKIP`, 나머지 진행 |
| 시트 fetch 실패 | `check_sheet`만 `SKIP` |
| 프로젝트 페이지 셀렉터 깨짐 | 해당 체커 `SKIP` + `errors[]` 기록 + Slack DM 통지 |
| git push 실패 | 로컬 JSON 살리고 다음 회차 재시도 |

**원칙:** 한 프로젝트의 한 체커가 깨져도 다른 프로젝트·다른 체커는 계속 돈다. 전체 중단은 인증 만료 같은 시스템적 장애만.

## 11. 로그·관측

- `logs/YYYY-MM-DD-{slot}.log` — stdout/stderr 동시 기록
- `audit.js` 종료 시 마지막 줄에 `EXIT_CODE` 출력
- Windows 작업 스케줄러가 종료 코드 ≠ 0 시 자체 알림

## 12. Windows 작업 스케줄러 등록

```
이름: service-init-audit-morning
트리거: 매일 08:30
동작: "C:\Program Files\nodejs\node.exe" "C:\Users\user\Documents\claude\service-init-audit\audit.js" --slot=morning

이름: service-init-audit-evening
트리거: 매일 17:30
동작: ... --slot=evening
```

→ `mcp__scheduled-tasks__create_scheduled_task`로 자동 등록.

## 13. 보관 정책

- `data/` JSON 파일: 90일 보관, 이후 자동 삭제 (배포 크기 관리)
- `logs/` 파일: 90일 보관
- `data/index.json`은 90일 윈도우의 매니페스트만 유지

## 14. 구현 시 미해결 사항 (구현 단계에서 확정)

이 설계서는 다음 항목을 **구현 시점에 데이터로 확인**한다 (현재 추정/플레이스홀더 없음, 단순히 코드 작성 단계에서 결정).

1. **슬랙 알림 메시지 패턴** — 어떤 문자열·블록 구조로 충전소 링크가 나타나는지. 첫 실행 시 샘플 메시지로 파서 작성.
2. **플링커넥트 페이지 셀렉터** — 계약탭/요금제탭/서비스개시탭/충전기 테이블의 정확한 CSS 셀렉터.
3. **영차영차new 시트의 프로젝트ID 컬럼 인덱스** — 매칭 키 컬럼. 기존 메모리에 따르면 connect `connectId`와 직접 매칭.
4. **특가합의서 첨부 위치** — 계약탭 내부 어느 영역에 첨부되는지.
5. **플링커넥트 API로 일부 데이터 조회 가능 여부** — 가능하면 Playwright 부담 감소.

이 5가지는 구현 1일차에 사용자와 함께 데이터 샘플로 확정.

## 15. 향후 확장

- GitHub Actions 또는 Vercel cron으로 클라우드 이관
- 슬랙 알림 스레드 답글 자동화
- VOC / 보조금 / 준공접수 단계 통합 대시보드
- 검증 실패 시 자동 PM 멘션 (단, 오탐률 충분히 낮아진 이후)
