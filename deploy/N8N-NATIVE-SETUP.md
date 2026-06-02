# service-init-audit — n8n 네이티브 셋업 (호스트 불필요)

connect 백엔드 API(`apis.pluglink.kr` / `search.pluglink.kr`, JWT)를 n8n HTTP 노드로 직접 호출 → PC/컨테이너 없이 n8n만으로 동작. 브라우저(Playwright) 불필요.

> ⚠️ 비밀번호는 **n8n Credential/Variable에 본인이 직접 입력**하세요. (어시스턴트가 대리 입력하지 않음 — 안전 규칙). 채팅에 노출된 비밀번호는 변경 권장.

## 발견된 API (실측)
- **로그인**: `POST https://apis.pluglink.kr/v101/admins/signIn` — body `{ "email": "...", "password": "..." }` → 응답에 JWT(토큰).
- **충전소 충전기**: `GET https://apis.pluglink.kr/v101/chargers/backoffices/stations/{stationId}` (인증 헤더 필요)
- **프로젝트**: `GET https://apis.pluglink.kr/v101/managements/projects`
- **검색**: `GET https://search.pluglink.kr/v101/stations/summaries`, `…/v101/chargers`
> 인증 헤더 포맷(예: `Authorization: Bearer <jwt>` 또는 커스텀 헤더)은 첫 로그인 응답으로 확정해야 함. signIn 응답 JSON의 토큰 필드명과 함께, 데이터 GET이 200 되는 헤더 형식을 1회 확인 후 고정.

## n8n 워크플로 구성 (사전 생성됨: id `qONFiRZ9EtBj3g3o`)
다음 노드를 순서대로:

1. **Schedule Trigger** ×2 — `5 8 * * *`, `5 17 * * *` (Asia/Seoul). (이미 있음)

2. **HTTP Request — Login**
   - Method POST, URL `https://apis.pluglink.kr/v101/admins/signIn`
   - Body(JSON): `{ "email": "={{ $credentials.plinkconnect.email }}", "password": "={{ $credentials.plinkconnect.password }}" }`
     - 또는 n8n **Variable**(`PLINK_EMAIL`/`PLINK_PW`)로 참조. **여기에 본인 계정 직접 입력.**
   - 응답에서 JWT 추출(Set 노드): `token = {{ $json.token ?? $json.data.token ?? $json.accessToken }}`.

3. **(discover) 대상 충전소 목록**
   - 오늘 개시: 기존 daily-briefing의 Slack 패턴 재사용(개시 알림 채널 C026XGZE1GT 파싱) — 또는 `search.pluglink.kr/v101/stations/summaries`에서 당일 개시 필터.
   - 내일 예정: 영차영차new 시트(gid 300841532) BR=대상일 — Google Sheets 노드(기존 OAuth credential `pNQhB5y1Ew7t4Y8v`).

4. **HTTP Request — 충전기 조회** (충전소별, Split In Batches 루프)
   - `GET apis.pluglink.kr/v101/chargers/backoffices/stations/{{ $json.stationId }}`
   - Header: `Authorization: Bearer {{ $node["Login"].json.token }}` (또는 확정된 포맷)

5. **Code 노드 — 판정** (레포 lib 로직 포팅)
   - 상태(통신 1시간): 각 충전기 `lastCommunication`(또는 API 필드)이 기준시각 −1h 이내인지. (lib/check_status_recent.js `judgeStatusRecent` 로직)
   - 요금제/공문/시트: 각 시트·Gmail 노드 결과와 결합(lib/check_rate.js·check_doc.js·check_sheet.js 로직).
   - 미운영+최근통신 → 원격제어 후보 추출(lib/remediate_charger.js `pickRemediationTargets`). ⚠️ 실제 제어 API는 별도 확인·검증 후 추가(실하드웨어 위험).

6. **Slack 노드 — notify** (기존 Slack credential)
   - lib/notify.js `buildSummaryText` 출력 형식 재현 → 채널/DM 발송.

## 자격증명 (n8n Credentials)
- **plinkconnect**: 본인이 신규 등록(email/password) — 위 Login 노드에서 참조.
- **Slack / Google**: 기존 daily-briefing credential 재사용 가능.

## 활성화·검증
1. plinkconnect 자격증명 입력 후 **수동 실행(Execute Workflow)** → Login 200 + 충전기 조회 200 확인.
2. 인증 헤더 포맷이 401이면 signIn 응답 토큰 필드/헤더명 조정.
3. Slack 발송 확인 후 **Publish(Version name 필수 입력)** → Active On.
4. 정상 후 Windows 작업 스케줄러 비활성화(이중 실행 방지).

> 포팅할 판정 로직은 레포 `lib/`의 순수 함수(judge*)를 그대로 옮기면 됩니다(외부 의존 없음). 대시보드(public/data + Vercel)는 이 경로에선 선택 — 필요 시 별도 Webhook/Storage로 설계.
