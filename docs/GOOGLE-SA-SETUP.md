# CI 구글 인증 복구 가이드 (관리자 없이 — 하이브리드)

GitHub Actions 러너엔 로그인된 구글 세션이 없어, 기존 방식(브라우저 gviz fetch + OAuth)으로는
**시트·요금제·공문 체크가 매번 SKIP** 됐다.

Workspace 슈퍼관리자가 없어 **도메인 위임은 불가**하므로, 위임 없이 가능한 **하이브리드**로 복구한다:
- **시트·요금제** → 서비스계정에 시트를 **공유**해서 읽기 (위임 불필요)
- **공문(Gmail)** → **OAuth 리프레시 토큰 재발급** (서비스계정은 위임 없이 메일함 접근 불가)

코드는 이미 대응 완료. `GOOGLE_SA_KEY`만 있고 `GOOGLE_DELEGATION`은 설정 안 하면 자동으로 이 하이브리드로 동작.

---

## Part A — 시트·요금제 복구 (서비스계정 공유) · 관리자 불필요

### A-1. (완료) API 활성화 + 서비스계정 + JSON 키
- Google Sheets API + Gmail API 활성화, 서비스계정 생성, JSON 키 다운로드까지 완료한 상태.
- 서비스계정 **이메일**(`xxx@<proj>.iam.gserviceaccount.com`) 확인:
  https://console.cloud.google.com/iam-admin/serviceaccounts → 계정 클릭 → 이메일 복사.

### A-2. 시트 2개를 서비스계정 이메일에 "뷰어" 공유
각 시트 열고 우상단 **공유** → 서비스계정 이메일 입력 → **뷰어** → 보내기:
- 영차영차new: https://docs.google.com/spreadsheets/d/18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI
- 영업관리(요금제): https://docs.google.com/spreadsheets/d/10arITgn0Eaa6nUchz3nza6w9ixkOzQC88j49QYvGwxU

### A-3. GitHub 시크릿 등록
https://github.com/woojungkim-pluglink/service-init-audit/settings/secrets/actions
- **`GOOGLE_SA_KEY`** = 다운로드한 JSON 파일 **전체 내용**.
- **`GMAIL_USER`** = `woojung.kim@pluglink.kr` (이미 있으면 확인만).
- `GOOGLE_DELEGATION`은 **설정하지 않음** (없어야 공유 기반으로 동작).

> 여기까지 하면 **시트·요금제·[HM]제외·내일개시 색인**이 CI에서 복구됨.

---

## Part B — 공문(Gmail) 복구 (OAuth 토큰 재발급) · 관리자 불필요

현재 `GMAIL_REFRESH_TOKEN`이 `invalid_grant`(만료/폐기) 상태. 재발급한다.

### B-1. (권장) OAuth 동의화면을 만료 안 되게
원인이 보통 OAuth 앱이 "테스트" 상태라 토큰이 **7일마다 만료**되는 것.
https://console.cloud.google.com/apis/credentials/consent
- **User Type을 "내부(Internal)"** 로 두면(워크스페이스 조직 프로젝트면 가능) 만료·검증 없이 조직 내 사용 가능.
- 또는 "앱 게시(프로덕션으로 푸시)".

### B-2. 리프레시 토큰 재발급 (로컬 PC)
1. `config/.env`에 `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` 채워져 있는지 확인.
2. OAuth 클라이언트(데스크톱/웹)의 **승인된 리디렉션 URI**에 `http://localhost:8080/callback` 등록:
   https://console.cloud.google.com/apis/credentials
3. 실행:
   ```
   node scripts/gmail_oauth.js
   ```
   브라우저 동의 → `config/.env`의 `GMAIL_REFRESH_TOKEN` 자동 갱신 + 콘솔에 토큰 출력.
   - "refresh_token 없음" 뜨면 https://myaccount.google.com/permissions 에서 기존 앱 제거 후 재실행.

### B-3. GitHub 시크릿 업데이트
출력된 새 토큰을 **`GMAIL_REFRESH_TOKEN`** 시크릿에 업데이트.
(`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`도 시크릿에 있어야 함)

---

## 검증
Part A만 끝나도 알려주세요(시트·요금제 먼저 확인 가능). Part B까지 끝나면 공문도 확인.
성공 시 morning 로그에 `[auth] sheets=sa gmail=oauth`, Slack 요약이
`공문 5/5 · 요금제 5/5 · 시트 5/5 · 상태 5/5`로 나오면 정상.

---

## (참고) 나중에 관리자가 생기면 — 풀 서비스계정
Workspace 관리자가 도메인 위임을 등록할 수 있게 되면, 시트·Gmail 모두 서비스계정으로 통일 가능:
1. 관리자 콘솔 https://admin.google.com/ac/owl/domainwidedelegation 에 서비스계정 **고유 ID(숫자)** +
   범위 `https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/gmail.readonly` 등록.
2. GitHub 시크릿 **`GOOGLE_DELEGATION=1`** 추가. 끝. (OAuth 토큰 불필요)

## 동작 원리
- `lib/google_auth.js`의 `buildGoogleAuth()`가 시트/Gmail 인증을 분리 생성.
  - 시트: `GOOGLE_SA_KEY` 있으면 Sheets API(`makeSheetsCsvFetcher` → gviz 호환 CSV로 직렬화 → 기존 파서 무수정).
  - Gmail: `GOOGLE_DELEGATION=1`이면 SA 임퍼소네이션, 아니면 OAuth 리프레시 토큰.
- 로컬에서 `GOOGLE_SA_KEY` 없이 실행하면 기존 방식(브라우저 gviz + OAuth)으로 자동 폴백.
