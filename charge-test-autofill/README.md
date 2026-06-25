# charge-test-autofill

플링커넥트 티켓(처리완료+이미지첨부) → 시트 J열(보완완료일자) 자동기입. GitHub Actions cron 1일 2회.

## 동작
- 대상 시트 `25년환경부_준공보완`(gid 619747296)의 각 행에서:
  - M열(`25년환경부_준공보완_충전테스트`)이 `T-숫자`면 그 티켓 조회
  - J열(`OnM 보완완료일자`)이 비어 있고, 티켓이 `COMPLETED` + 이미지 첨부 ≥1이면
  - 티켓 `completedAt`의 날짜(YYYY-MM-DD)를 J열에 기입
- J가 이미 차 있으면 건드리지 않음(수기값 보존).

## 배포 (service-init-audit 저장소에 통합됨)

이 자동화는 `service-init-audit` 저장소의 서브폴더(`charge-test-autofill/`)로 통합되어,
그 저장소에 이미 등록된 Actions Secrets(`GOOGLE_SA_KEY`, `SLACK_BOT_TOKEN`,
`NOTIFY_SLACK_USER_ID`, `NOTIFY_SLACK_CHANNEL_ID`, `PLINKCONNECT_USERNAME/PASSWORD`)를
그대로 재사용한다. 워크플로: 루트 `.github/workflows/charge-test-autofill.yml`.

### 활성화 체크리스트
1. 대상 시트(`25년환경부_준공보완`)를 서비스계정
   `service-init-audit@service-init-audit.iam.gserviceaccount.com` 에 **편집자**로 공유. *(필수)*
2. `feat/charge-test-autofill` 브랜치를 `master`에 머지(예약 워크플로는 기본 브랜치에서만 실행).
3. Actions → charge-test-autofill → Run workflow → `dry_run=true` 로 1회 검증.
4. `dry_run=false`(스케줄) 로 실주행, 시트·Slack 확인.

## 로컬 실행
```bash
cp config/.env.example config/.env   # 값 채우기 (GOOGLE_SA_KEY = SA JSON 한 줄)
npm install
npm test          # 단위테스트
npm run dry-run   # 쓰기 없이 기입 예정 목록 출력
```

## cron 시각
- 09:00, 17:00 KST (루트 `.github/workflows/charge-test-autofill.yml`). 변경 시 UTC로 환산.
