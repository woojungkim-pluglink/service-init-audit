# service-init-audit — PC 비의존 자동 실행 (클라우드 컨테이너 + n8n 트리거)

목표: Windows 작업 스케줄러(PC 상시 가동 필요)를 → 클라우드 컨테이너 + n8n Schedule 트리거로 이관.

```
n8n Schedule(08:05/17:05 KST) → HTTP POST /run?slot= → 컨테이너(Playwright audit 실행) → Slack/Vercel
```

## 0. 구성요소 (이 폴더)
- `Dockerfile` — Playwright(Chromium) 포함 컨테이너. `deploy/server.js`를 CMD로 구동.
- `server.js` — 트리거 웹훅. `POST /run?slot=morning|evening` (헤더 `x-trigger-secret`) → `audit.js` 백그라운드 실행, 202 즉시 반환. `GET /health`.
- `n8n-service-init-audit.json` — n8n 워크플로(2 Schedule → 2 HTTP). URL/시크릿 placeholder.
- `.dockerignore`.

## 1. 빌드 (레포 루트에서)
```bash
docker build -f deploy/Dockerfile -t service-init-audit .
```
- Playwright npm 버전(현재 ^1.47)과 Dockerfile 베이스 태그(`v1.47.0-jammy`)를 일치시킬 것. package.json playwright 버전 올리면 베이스 태그도 같이 올린다.

## 2. 필요한 환경변수/시크릿 (컨테이너 런타임에 주입 — 절대 이미지에 굽지 말 것)
| 변수 | 용도 |
|------|------|
| `TRIGGER_SECRET` | n8n과 공유하는 웹훅 시크릿(임의 강한 문자열) |
| `PLINKCONNECT_USERNAME` / `PLINKCONNECT_PASSWORD` | connect 자동 로그인(빈 프로필 → ensureSession) |
| `SLACK_BOT_TOKEN`, `NOTIFY_SLACK_USER_ID`, `NOTIFY_SLACK_CHANNEL_ID`, `SLACK_CHANNEL_ID` | discover + notify |
| `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`, `GMAIL_USER` | 공문 체크 |
| `PM_GROUP_EMAILS`, `DASHBOARD_URL`, `PLINKCONNECT_BASE`, `DATA_RETENTION_DAYS` | 기타 |
| `VERCEL_TOKEN` (+ 프로젝트 링크) | 컨테이너에서 `npx vercel deploy --prod` 하려면 필요 |
> 현재 `config/.env`의 키들을 그대로 컨테이너 env로 옮기면 됨. (`.env`는 이미지에 포함 금지 — .dockerignore 확인)

## 3. 상태(대시보드 데이터) 영속화 — 중요
대시보드 누적 데이터는 `public/data/*.json` + `index.json`(90일 보관). 컨테이너는 매 실행 stateless라 그대로면 히스토리가 사라진다. 둘 중 하나:
- (권장) `public/data`를 **퍼시스턴트 볼륨**에 마운트 → 히스토리 누적 + 컨테이너에서 `vercel deploy`.
- 또는 audit를 "Vercel 배포는 외부에서" 모드로 바꾸고, 데이터는 객체스토리지/깃에 적재(코드 변경 필요).
첫 부팅 시 볼륨이 비어 있으면 라이브 대시보드(`/data/index.json`)에서 시드 복사해두면 끊김 없음.

## 4. 호스팅 (택1, 사용자 클라우드 계정 필요)
- **Google Cloud Run**: `gcloud run deploy service-init-audit --source . --port 8080 --memory 2Gi --timeout 3600 --no-allow-unauthenticated`. 볼륨은 GCS FUSE 또는 Cloud Run volume. 단, Cloud Run은 요청당 타임아웃(최대 60분) — audit ~20분이라 OK(202 즉시 반환 + 백그라운드라 더 안전).
- **Fly.io / Railway / Render**: 컨테이너 + 퍼시스턴트 볼륨 지원, always-on 머신.
- **소형 VM(+docker)**: `docker run -d -p 8080:8080 --env-file prod.env -v /data/sia:/app/public/data service-init-audit`.
메모리 2GB+ 권장(Chromium). 외부에서 호출 가능한 HTTPS URL 확보.

## 5. n8n 워크플로 등록
1. n8n.pluglink.kr → Import from File → `deploy/n8n-service-init-audit.json`.
2. 두 HTTP 노드의 `url`을 4단계 컨테이너 URL로, 헤더 `x-trigger-secret`을 `TRIGGER_SECRET` 값으로 교체.
3. **Publish 시 Version name 반드시 입력**(미입력 시 활성 버전 stale — 기존 트러블슈팅 참고).
4. 워크플로 Active On.
> cron: 매일 08:05/17:05(Asia/Seoul). 주말 제외하려면 `5 8 * * 1-5`로 변경(단, 다음날-예정 주말커버는 금요일 evening이 토·일·월을 다루도록 설계됨).

## 6. 검증 → 전환
1. 수동 호출 테스트: `curl -X POST -H "x-trigger-secret: <SECRET>" "https://<HOST>/run?slot=morning"` → 202 + 컨테이너 로그 `webhook-morning-*.log` 확인 → 대시보드 갱신/Slack 발송 확인.
2. n8n에서 워크플로 수동 실행으로 트리거 경로 확인.
3. 정상 확인 후 **기존 Windows 작업 스케줄러 비활성화**: `Disable-ScheduledTask -TaskName service-init-audit-morning` / `...-evening` (이중 실행 방지).

## 주의
- audit는 `chrome_profile` 단일 세션 → server.js가 동시 실행을 409로 차단. n8n 두 트리거가 겹치지 않게 시간 분리(08:05/17:05) 유지.
- 원격제어(미운영→운영)는 실모드에서 실제 동작 — 컨테이너에서도 동일. 첫 배포 후 첫 실모드 실행은 로그로 결과 확인 권장.
