# 개시 후 30일 정착 추적 ("settle") — 설계

- 날짜: 2026-08-10
- 상태: 사용자 승인 (대시보드 전용, Slack 발송 없음)
- 목적: 서비스개시된 충전기가 개시 이후 30일 안에 죽는(통신 두절·사용불가·에러) 것을 조기 발견한다. 기존 audit은 개시 *당일*만 보고 끝나며, 개시 이후 이상은 아무도 추적하지 않는 공백을 메운다.

## 배경 — 데이터 소스 (2026-08-10 실측 확인)

플링커넥트 대시보드 하단 "충전기 상태관리 > 실시간 충전기 상태" 위젯의 API:

| 용도 | 엔드포인트 |
|---|---|
| 3종 카운터 | `GET https://search.pluglink.kr/v101/dashboards/status/accumulations` → `{failedConnection, failedUsable, isError}` |
| 이상 목록 | `GET https://search.pluglink.kr/v101/dashboards/status/devices?statusType={failedConnection\|failedUsable\|isError}&size=N&field=packetReceivedAt&direction=ASC` (Spring 페이징: `totalElements/totalPages/content[]`) |

- 인증: 커넥트 localStorage `token`의 JWT → `Authorization: Bearer` + `x-channel: PLUGLINK`, `x-platform: WEB`, `x-token: PLUGLINK` 헤더. 만료 약 24h — 매 실행 시 기존 Playwright 폼 로그인(`plinkconnect_auth.js`) 후 추출.
- 목록 항목은 charger 전체 문서: `launchedAt`, `station.{id,name,address}`, `operationStatus`, `cpo.partnerId`, `devices[].{deviceId,packetReceivedAt,rsrp,dial,errorCode,status,isError}`, 최상위 `packetReceivedAt` 포함. → **개시일 기준 역필터가 가능**해 코호트 저장 없이 추적이 성립한다.

## 채택안 — launchedAt 역필터 (A안)

코호트를 저장하지 않는다. 매 실행이 독립적으로:

1. 커넥트 로그인 세션에서 JWT 추출
2. 3종 이상 목록 전체 페이징 수집 (~1,000건 규모, size를 크게 잡아 호출 수 최소화)
3. `launchedAt ≥ 오늘−30일` + `cpo.partnerId === 1` 필터 → D+N(개시 경과일) 계산
4. 직전 `settle.json`과 diff → 신규 진입(↑) / 복구(↓)
5. `settle.json` 게시 → 대시보드 새 패널 렌더

기각안: (B) 코호트 등록·체크포인트 — Slack 알림 파싱 의존(파트너 개시 누락 함정 `relationPartnerId=1`), 상태 파일 수명 관리, audit 실패일 코호트 유실. 구현량 대비 가치가 diff 표시로 대부분 대체됨. (C) n8n 단독 — JWT 갱신 불가.

## 판정·필터 규칙

- **대상**: `launchedAt` 30일 이내 AND `cpo.partnerId=1`(플러그링크 CPO 한정 — 온톨로지 `operations-cs.function.proactive-fault-detection` 정본 규칙). 파트너 CPO 제외분은 건수만 메타 기록.
- **통신미연결 재판정**: 위젯 라벨(`connectionStatus`/`isConnection`) 사용 금지(온톨로지 SoT 규칙). `packetReceivedAt` 실측으로 두절 기간 산출 → `<1h(조기)` / `1h~24h` / `1~7일` / `7일+` 구간.
  - RSRP 0/양수/미보고 → '신호 미보고' 분류만 (단독 승격 금지)
  - 동일 CTN(dial) 2대+ 공유 중 단절 포함 → '거점 동시단절 위험' 병기
  - 기존 `lib/check_commstatus.js` 판정 로직 재사용
- **사용불가(failedUsable)·에러(isError)**: 위젯 판정 수용 + `errorCode`·`status` 병기.
- 한 충전기가 복수 유형에 걸리면 1행으로 합치고 유형 배지를 복수 표시.

## 실행·게시

- 트리거: 기존 audit 실행(08:05/17:05 KST, n8n→GitHub Actions `workflow_dispatch` + cron 백업)에 settle 단계 추가. **새 트리거 없음.**
- 산출물: `settle.json` (최신 스냅샷 1개 + 직전 대비 diff + 수집 메타). 기존 Vercel 배포 플로우에 포함.
- diff 기준: CI는 stateless이므로 직전 스냅샷은 라이브 대시보드의 `settle.json`을 실행 시작 시 fetch해서 얻는다 (audit.js가 live `index.json`으로 dedup하는 기존 패턴과 동일). 최초 실행·fetch 실패 시 diff 생략(스냅샷만 게시).
- Slack 발송 없음 — 대시보드 전용. 기존 audit Slack 알림은 변경하지 않는다.

## 대시보드 패널

service-init-audit.vercel.app에 "개시 후 정착 추적 (D+30)" 섹션 추가:

- 요약 타일: 추적 이상 건수 / 신규 진입 ↑ / 복구 ↓ / (참고) 위젯 전체 3종 카운터
- 목록: 충전소(커넥트 `operation/stations/{id}/home` 링크) · 충전기 ID · 이상 유형 · D+N · 두절 기간 구간 · 개시일 — **D+N 오름차순**(갓 개시된 것 우선)
- 공개 대시보드 주의(무인증): CTN(dial)은 뒤 4자리만, `networkAddress`(내부 IP)는 미게시.

## 에러 처리

- settle 단계 실패는 기존 audit 결과·exit code에 영향 주지 않음 (catch 후 계속).
- 실패 시 settle.json에 `error` 필드 + 마지막 성공 시각 기록 → 대시보드 "갱신 실패 (마지막 성공: …)" 배너 + 직전 성공 데이터 유지. 조용한 실패 금지.
- JWT 추출 실패(로그인 실패)도 동일 경로.

## 테스트

- 필터·D+N·diff·통신 재판정은 순수 함수로 분리, fixture JSON(실 API 응답 축약본)으로 단위 테스트 (`tests/` 관례, node --test).
- API 페이징·JWT 추출은 구현 시 실 세션 dry-run 1회로 검증.

## 이 설계가 참조한 정본 규칙 (온톨로지)

- 통신 SoT = `packetReceivedAt`, 라벨 판정 금지 — `operations-cs.function.proactive-fault-detection`
- RSRP 오탐 가드, CPO=1 한정, 거점 동시단절 정의 — 같은 자산
- 개시 3원 전이(충전기·충전소·availability 분리) — `charging-core.flow.charger-operation-lifecycle`
- Slack 개시 알림의 파트너 제외 함정 — `operations-cs.flow.launched-charger-daily-notify`
