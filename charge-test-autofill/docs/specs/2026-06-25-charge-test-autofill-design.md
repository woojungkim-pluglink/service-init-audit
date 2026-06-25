# 충전테스트 보완완료일자 자동 기입 — 설계서

- 작성일: 2026-06-25
- 작성자: 쿠이(woojung.kim@pluglink.kr) + Claude
- 상태: 설계 확정(사용자 검토 대기)

## 1. 목적

`25년환경부_준공보완` 시트의 "충전테스트 요청"(gid 619747296)에서, M열에 적힌 플링커넥트
티켓이 **처리완료 + 이미지 첨부** 상태가 되면, 그 티켓의 완료일자를 J열(`OnM 보완완료일자`)에
자동으로 기입한다. PC 전원과 무관하게 **클라우드에서 1일 2회** 자동 실행한다.

## 2. 대상 시트

- 스프레드시트 ID: `1uf9BmYEvT424rUOD9mpCheVkuBS_7xb9LOjM4aC57bY`
- 시트(탭): `25년환경부_준공보완`, gid `619747296`
- 헤더 ↔ 열 매핑(1행이 헤더, 데이터는 2행부터):

| 열 | 헤더 | 역할 |
|---|---|---|
| A | PM 대기번호 | 참조 |
| D | PM 충전소ID | 참조(검증용) |
| E | PM 충전기번호 | 참조 |
| B | PM 충전소명 | 참조(티켓 station 교차확인용) |
| I | OnM 요청확인 | 참조 |
| **J** | **OnM 보완완료일자** | **← 기입 대상(출력)** |
| K | OnM 사진대지 업로드 | 참조 |
| L | PM 환경부 보완완료 | 참조 |
| **M** | **25년환경부_준공보완_충전테스트** | **← 티켓ID 보유(입력)** |

## 3. 핵심 로직 (행 단위)

데이터 행마다(2행부터) 다음을 수행:

1. **M열 티켓ID 추출**: 값이 `T-숫자` 패턴(`/T-\d+/`)에 매칭되면 숫자부를 ticketId로 사용.
   매칭 안 되면(빈칸, `거점별 1기만 사진 확보하여 재요청` 등 메모) **스킵**.
2. **J열 비어있음 확인**: J가 이미 채워져 있으면 **스킵**(수기/기존값 보존, 덮어쓰기 금지).
3. **티켓 상세 조회**: `GET /v101/crms/tickets/{ticketId}`.
4. **기입 조건 판정** — 둘 다 충족해야 기입:
   - `status == "COMPLETED"` (= "처리완료")
   - `files` 배열 중 **이미지 파일이 1개 이상**.
     - 이미지 판별: `name` 또는 `url`의 확장자가
       `.jpg .jpeg .png .gif .webp .heic .bmp` 중 하나(대소문자 무시).
     - (`files`의 `type` 필드는 null로 관측되어 확장자 기준으로 판별)
5. **기입값**: `completedAt`의 날짜 부분만(`"2026-01-22 00:00:00"` → `"2026-01-22"`).
6. 해당 행의 `J{행번호}` 셀에 기입.

### 조건 미충족 시
- COMPLETED 아님 → 다음 실행에서 재확인(기입 안 함).
- COMPLETED지만 이미지 없음 → 기입 안 함, "이미지 미첨부"로 분류해 알림에 표기.

## 4. 실행 환경

- **GitHub Actions cron** (무료, 클라우드, PC 독립).
- 1일 2회 — 기본 09:00 / 17:00 KST. UTC 환산 cron 2줄:
  - `0 0 * * *` (09:00 KST)
  - `0 8 * * *` (17:00 KST)
  - (필요 시 service-init-audit처럼 n8n 정시 트리거로 보강 가능)

## 5. 인증

| 대상 | 방식 | 비고 |
|---|---|---|
| 플링커넥트 API | `POST /v101/auths/admins/signIn` (email/PW) → JWT Bearer | 브라우저 불필요(헤드리스 검증 완료) |
| 구글시트 읽기·쓰기 | 서비스계정 JWT(`GOOGLE_SA_KEY`) + Sheets API v4 | service-init-audit `lib/google_auth.js` 패턴 재사용 |

- 공통 헤더: `x-channel: PLUGLINK`, `x-platform: WEB`, `x-token: PLUGLINK`, `Origin: https://connect.pluglink.kr`.
- 로그인 시 `x-token: 1`.
- 시트 읽기: `spreadsheets.values.get`(FORMATTED_VALUE). 쓰기: `spreadsheets.values.update`
  (`valueInputOption: USER_ENTERED`, 단일 셀 `J{row}` 또는 batchUpdate).

## 6. 사전 준비물 (사용자/관리자 조치 필요)

1. **대상 시트를 서비스계정 이메일에 "편집자"로 공유.**
   현재 service-init-audit 서비스계정은 다른 시트에 읽기 권한만 있음. 쓰기를 위해 편집 권한 필수.
   (동일 SA 재사용 또는 신규 SA 발급 후 `GOOGLE_SA_KEY` 시크릿 등록)
2. **비공개 GitHub 저장소 1개** — 코드 + Actions Secrets 보관.

## 7. 컴포넌트 구조 (Node, ESM)

```
charge-test-autofill/
├── index.js                     # 진입점: 인자 파싱, dry-run, 오케스트레이션
├── lib/
│   ├── pluglink.js              # login(), getTicket(id)
│   ├── sheets.js                # readSheet(), writeCell() (googleapis)
│   ├── logic.js                 # 행 평가: 추출/조건판정/기입값 산출 (순수함수, 테스트 대상)
│   └── notify.js                # Slack 요약 (@slack/web-api)
├── package.json                 # googleapis, @slack/web-api, dotenv
├── tests/
│   └── logic.test.js            # node --test: 패턴/조건/날짜 변환 단위 테스트
├── config/.env.example
├── docs/specs/...               # 본 문서
└── .github/workflows/autofill.yml
```

순수 판정 로직(`lib/logic.js`)은 I/O와 분리하여 단위 테스트로 검증한다.

## 8. 알림 (Slack)

- service-init-audit 패턴 재사용: `@slack/web-api` `chat.postMessage`.
- 수신: 쿠이 DM(`NOTIFY_SLACK_USER_ID`). (채널 동시 발송은 선택)
- 매 실행 후 1건 요약:
  - `J열 기입 N건`(충전소명 + 날짜 목록)
  - `대기 N건`(티켓 미완료)
  - `이미지 미첨부 N건`(완료지만 이미지 없음 — 사람 확인 필요)
  - `오류 N건`(티켓 조회 실패 등)
- 변경 0건이면 무알림 옵션(소음 방지) — 기본은 무알림, `--always-notify`로 강제.

## 9. 안전장치 / 엣지케이스

- **드라이런(`--dry-run`)**: 실제 쓰기 없이 "행→기입예정값" 목록만 출력 + Slack 미발송.
  최초 1회는 반드시 dry-run으로 사람 확인 후 실주행.
- **J 보존**: J 비어있을 때만 기입. 기존값 절대 덮어쓰지 않음.
- **행 정합성**: gviz/values.get의 행 순서 = 시트 실제 행. 헤더 1행 → 데이터는 시트 2행부터.
  값 배열 인덱스 i(0-base, 데이터) → 시트 행 = i + 2. `J{i+2}`에 기입.
- **티켓ID 중복**: 동일 티켓ID가 여러 행(충전기별)에 있을 수 있음 → 각 행 독립 처리(정상).
- **API 레이트리밋**: 행 수가 ~990건. M에 티켓 있는 행만 상세조회(현재 소수). 조회 간 소량 지연/재시도.
- **JWT 만료**: 매 실행마다 새로 로그인(토큰 캐시 안 함) — service-init-audit/ticket_notifier 동일 전략.
- **시트 권한 오류**: 쓰기 403 시 명확한 에러 로그 + Slack 오류 알림.

## 10. 비기능 / 보안

- 모든 시크릿은 GitHub Actions Secrets로만 주입(코드 하드코딩 금지).
- 로그에 비밀번호/토큰 미출력.
- (참고) 기존 `ticket_notifier.py`에 비밀번호 하드코딩되어 있음 — 본 프로젝트 범위 밖이나 별도 정리 권장.

## 11. 검증 계획

1. `lib/logic.js` 단위 테스트(패턴 매칭, 비이미지 첨부, 미완료, 날짜 변환, J보존).
2. 실데이터 dry-run: 알려진 행(347 송추우리마을, T-547438 → 2026-01-22)과 기존 수기 J값 일치 확인.
3. 쓰기 1행 한정 실주행 후 시트 확인 → 전체 활성화.

## 12. 미해결/확정 필요

- [ ] 서비스계정 편집 권한 공유(또는 신규 SA 발급) — 사용자 조치.
- [ ] GitHub 저장소 생성 위치/이름 — 사용자 확인.
- [ ] cron 시각 09:00/17:00 KST 확정(조정 가능).
- [ ] Slack 수신 대상(쿠이 DM 기본).
