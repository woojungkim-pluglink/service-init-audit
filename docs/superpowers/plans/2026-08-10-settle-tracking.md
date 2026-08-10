# 개시 후 30일 정착 추적 (settle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플링커넥트 "실시간 충전기 상태" 위젯 API를 이용해, 서비스개시 후 30일 이내 충전기가 이상 목록(통신미연결·사용불가·에러)에 있으면 대시보드 전용 패널로 추적한다. Slack 발송 없음.

**Architecture:** 기존 `audit.js` 실행(08:05/17:05 KST)에 settle 단계 추가. 커넥트 로그인 세션에서 JWT 추출 → `search.pluglink.kr` 이상 목록 3종 페이징 수집 → `launchedAt` 30일 이내 + CPO=플러그링크 필터 → 라이브 `settle.json`과 diff → `public/data/settle.json` 게시 → 정적 대시보드가 렌더.

**Tech Stack:** Node 20+ ESM (신규 의존성 없음 — 글로벌 `fetch` 사용), Playwright(기존 세션 재사용), `node --test`, 바닐라 JS 정적 대시보드(Vercel).

**Spec:** `docs/superpowers/specs/2026-08-10-settle-tracking-design.md`

## Global Constraints

- 프로젝트 루트: `C:\Users\user\Documents\claude\service-init-audit`. 모든 경로는 루트 기준.
- Node >= 20, `"type": "module"` (ESM `import`만 사용). 신규 npm 의존성 추가 금지.
- 테스트: `node --test tests/*.js` (`npm test`). 기존 테스트 전부 계속 통과해야 함.
- 주석·로그는 기존 파일과 같은 한국어 스타일. 이모지는 기존 코드에서 쓰는 곳(✅ 등) 외 금지.
- **Slack 발송 절대 추가 금지** — settle은 대시보드 전용. `notify.js` 수정 금지.
- settle 실패가 기존 audit 결과·exit code를 바꾸면 안 됨 (모든 예외는 settle 내부에서 흡수).
- 공개 대시보드 PII/내부정보: CTN(dial)은 마스킹(뒤 4자리), `networkAddress`·`lteAddress`는 settle.json에 절대 포함 금지.
- API 실측 사실 (2026-08-10 검증 완료 — 재검증 불필요):
  - `GET https://search.pluglink.kr/v101/dashboards/status/accumulations` → `{data:{failedConnection,failedUsable,isError}}`
  - `GET https://search.pluglink.kr/v101/dashboards/status/devices?statusType=<T>&size=100&page=<P>&field=packetReceivedAt&direction=ASC`
  - **page는 1-based** (page=0 → HTTP 400). size=100 정상 동작(그때 totalPages=8). 응답 `data`: Spring 페이지(`content[]`, `totalPages`, `totalElements`, `number`(0-based)).
  - 인증 헤더: `authorization: Bearer <JWT>`, `x-channel: PLUGLINK`, `x-platform: WEB`, `x-token: PLUGLINK`. JWT는 connect.pluglink.kr localStorage 키 `token`(raw 문자열, `eyJ` 시작), 만료 약 24h.
  - `content[]` 항목 = charger 전체 문서: `id`, `launchedAt("YYYY-MM-DD HH:mm:ss" KST)`, `operationStatus`, `station.{id,name,address,roadNameAddress}`, `cpo.{partnerId}`, `packetReceivedAt`(최상위), `devices[].{deviceId,packetReceivedAt,rsrp,dial,errorCode,status,networkAddress,...}`.
- 온톨로지 정본: 통신 판정에 `connectionStatus`/`isConnection` 라벨 사용 금지, `packetReceivedAt` 실측만. RSRP 0/양수/미보고 = '신호 미보고' 분류만(단독 승격 금지). CPO `partnerId=1` 한정. `(테스트)` 충전소 제외.
- `lib/retention.js`의 pruneDataDir는 `YYYY-MM-DD-` 접두 파일만 삭제 → `settle.json`은 안전 (확인 완료, 수정 불필요).

## File Structure

| 파일 | 역할 |
|---|---|
| Create `lib/settle_core.js` | 순수 로직: 정규화·병합·필터·D+N·두절 분류·마스킹·스냅샷·diff. I/O 없음 |
| Create `lib/settle_api.js` | I/O: JWT 추출(Playwright), 3종 목록 페이징 fetch, 카운터 fetch, 라이브 settle.json fetch. `fetchImpl` 주입으로 테스트 가능 |
| Create `lib/settle.js` | 오케스트레이터 `runSettle()` — 절대 throw하지 않음, settle.json 기록 |
| Modify `audit.js` | ctx 생성 조건 확장 + settle 단계 삽입 + `--no-settle` 플래그 |
| Modify `.github/workflows/service-init-audit.yml` | seed 단계에 settle.json 추가 (배포 시 유실 방지) |
| Modify `public/index.html`, `public/app.js`, `public/styles.css` | "개시 후 정착 추적" 패널 |
| Test `tests/test_settle_core.js`, `tests/test_settle_api.js` | 단위 테스트 |

---

### Task 1: `lib/settle_core.js` — 순수 로직

**Files:**
- Create: `lib/settle_core.js`
- Test: `tests/test_settle_core.js`

**Interfaces:**
- Consumes: `parseKstTimestamp(s)` from `lib/check_status_recent.js` (epoch ms | null 반환, KST 문자열 파싱 — 기존 함수)
- Produces (Task 3·5가 사용):
  - `STATUS_TYPES: string[]` — `['failedConnection','failedUsable','isError']`
  - `buildSnapshot({byType, accumulations, date, slot, runAt, refEpochMs, windowDays=30, truncated=false})` → settle.json 객체(diff 제외)
  - `diffSnapshots(prev, next)` → `{newEntries: number[], recovered: {chargerId,stationName,types}[]}`
  - 내부 단위(테스트용 export): `dPlusOf`, `classifyOutage`, `maskCtn`, `normalizeItem`, `mergeByCharger`, `filterTracked`, `markSharedModemRisk`, `finalizeItem`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_settle_core.js` 생성:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dPlusOf, classifyOutage, maskCtn, mergeByCharger, filterTracked,
  markSharedModemRisk, buildSnapshot, diffSnapshots
} from '../lib/settle_core.js';

// 기준시각: 2026-08-10 09:00:00 KST
const REF = Date.UTC(2026, 7, 10, 0, 0, 0);
const TODAY = '2026-08-10';

// API 원시 charger 문서 최소 재현 빌더
const raw = (id, over = {}) => ({
  id,
  launchedAt: '2026-08-01 00:00:00',
  operationStatus: 'OPERATION',
  packetReceivedAt: '2026-08-10 08:30:00',
  station: { id: 10000175, name: '파크타워', address: '서울특별시 용산구 서빙고로 67', roadNameAddress: '서울특별시 용산구 서빙고로 67' },
  cpo: { partnerId: 1 },
  devices: [{
    deviceId: 'PL10212766', packetReceivedAt: '2026-08-10 08:30:00',
    rsrp: -86, dial: '01236648368', errorCode: null, status: 'Available',
    networkAddress: '10.146.207.234'
  }],
  ...over
});

test('dPlusOf: 개시일-오늘 날짜 차이(일), 형식 오류는 null', () => {
  assert.equal(dPlusOf('2026-08-01 00:00:00', TODAY), 9);
  assert.equal(dPlusOf('2026-08-10 00:00:00', TODAY), 0);
  assert.equal(dPlusOf(null, TODAY), null);
  assert.equal(dPlusOf('', TODAY), null);
});

test('classifyOutage: 두절 구간 분류', () => {
  assert.equal(classifyOutage('2026-08-10 08:30:00', REF).bucket, 'lt1h');   // 30분 전
  assert.equal(classifyOutage('2026-08-09 20:00:00', REF).bucket, 'h1d24');  // 13시간 전
  assert.equal(classifyOutage('2026-08-06 09:00:00', REF).bucket, 'd1d7');   // 4일 전
  assert.equal(classifyOutage('2026-07-06 17:16:13', REF).bucket, 'gt7d');   // 한 달 전
  assert.equal(classifyOutage(null, REF).bucket, null);
});

test('maskCtn: 뒤 4자리만', () => {
  assert.equal(maskCtn('01236648368'), '****8368');
  assert.equal(maskCtn('-'), null);
  assert.equal(maskCtn(''), null);
});

test('mergeByCharger: 두 유형에 걸친 충전기는 1건으로 병합 + types 누적', () => {
  const items = mergeByCharger({
    failedConnection: [raw(1), raw(2)],
    failedUsable: [],
    isError: [raw(1)]
  });
  assert.equal(items.length, 2);
  const it1 = items.find(i => i.chargerId === 1);
  assert.deepEqual(it1.types, ['failedConnection', 'isError']);
});

test('filterTracked: CPO≠1·(테스트)·창 밖·개시일 없음 제외 + 경계값', () => {
  const items = mergeByCharger({ failedConnection: [
    raw(1),                                                          // D+9 → 포함
    raw(2, { cpo: { partnerId: 72 } }),                              // 파트너 CPO
    raw(3, { cpo: null }),                                           // CPO 미상 → 파트너 취급 제외
    raw(4, { station: { ...raw(4).station, name: '(테스트)롯데' } }), // 테스트소
    raw(5, { launchedAt: '2026-07-10 00:00:00' }),                   // D+31 → 창 밖
    raw(6, { launchedAt: '2026-07-11 00:00:00' }),                   // D+30 → 경계 포함
    raw(7, { launchedAt: null }),                                    // 개시일 없음
    raw(8, { launchedAt: '2026-08-11 00:00:00' })                    // D-1(미래) → 창 밖
  ], failedUsable: [], isError: [] });
  const { tracked, excluded } = filterTracked(items, { today: TODAY, windowDays: 30 });
  assert.deepEqual(tracked.map(t => t.chargerId).sort(), [1, 6]);
  assert.equal(tracked.find(t => t.chargerId === 6).dPlus, 30);
  assert.equal(excluded.partnerCpo, 2);   // id 2, 3
  assert.equal(excluded.testStation, 1);
  assert.equal(excluded.outsideWindow, 2); // id 5, 8
  assert.equal(excluded.noLaunchedAt, 1);
});

test('markSharedModemRisk: 전체 이상 목록에서 동일 dial 2대+ → 플래그', () => {
  const all = mergeByCharger({ failedConnection: [
    raw(1), raw(2), // 같은 dial 01236648368
    raw(3, { devices: [{ ...raw(3).devices[0], dial: '01000000000' }] })
  ], failedUsable: [], isError: [] });
  const { tracked } = filterTracked(all, { today: TODAY, windowDays: 30 });
  markSharedModemRisk(tracked, all);
  assert.equal(tracked.find(t => t.chargerId === 1).sharedModemRisk, true);
  assert.equal(tracked.find(t => t.chargerId === 3).sharedModemRisk, false);
});

test('buildSnapshot: dPlus 오름차순 정렬 + 위생처리(내부정보 제거) + 메타', () => {
  const snap = buildSnapshot({
    byType: {
      failedConnection: [raw(1, { launchedAt: '2026-07-25 00:00:00' }), raw(2, { launchedAt: '2026-08-08 00:00:00' })],
      failedUsable: [], isError: []
    },
    accumulations: { failedConnection: 782, failedUsable: 98, isError: 81 },
    date: TODAY, slot: 'morning', runAt: '2026-08-10T00:00:00.000Z',
    refEpochMs: REF, windowDays: 30, truncated: false
  });
  assert.deepEqual(snap.items.map(i => i.chargerId), [2, 1]); // D+2 < D+16
  const s = JSON.stringify(snap);
  assert.ok(!s.includes('networkAddress') && !s.includes('10.146.207.234'), '내부 IP 유출 금지');
  assert.ok(!s.includes('01236648368'), 'CTN 원본 유출 금지');
  assert.equal(snap.items[0].ctnMasked, '****8368');
  assert.equal(snap.accumulations.failedConnection, 782);
  assert.equal(snap.fetched.total, 2);
  assert.equal(snap.error, null);
});

test('buildSnapshot: 통신미연결 아닌 항목은 outageBucket 없음(null)', () => {
  const snap = buildSnapshot({
    byType: { failedConnection: [], failedUsable: [raw(1)], isError: [] },
    accumulations: null, date: TODAY, slot: 'morning',
    runAt: '2026-08-10T00:00:00.000Z', refEpochMs: REF
  });
  assert.equal(snap.items[0].outageBucket, null);
  assert.deepEqual(snap.items[0].types, ['failedUsable']);
});

test('diffSnapshots: 신규 진입·복구 검출, 창 이탈(에이징아웃)은 복구 아님', () => {
  const prev = {
    date: '2026-08-09', windowDays: 30,
    items: [
      { chargerId: 1, stationName: 'A', types: ['failedConnection'], dPlus: 5 },
      { chargerId: 2, stationName: 'B', types: ['isError'], dPlus: 30 }  // 다음날 D+31 → 창 이탈
    ]
  };
  const next = {
    date: '2026-08-10', windowDays: 30,
    items: [{ chargerId: 9, stationName: 'C', types: ['failedConnection'], dPlus: 1 }]
  };
  const d = diffSnapshots(prev, next);
  assert.deepEqual(d.newEntries, [9]);
  assert.equal(d.recovered.length, 1);           // id 1만 복구 (id 2는 에이징아웃)
  assert.equal(d.recovered[0].chargerId, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

실행: `cd "C:\Users\user\Documents\claude\service-init-audit" && node --test tests/test_settle_core.js`
기대: FAIL — `Cannot find module '.../lib/settle_core.js'`

- [ ] **Step 3: 구현 작성**

`lib/settle_core.js` 생성:

```js
/**
 * 개시 후 30일 정착 추적(settle) — 순수 로직 (I/O 없음).
 *
 * 데이터 소스: 플링커넥트 "실시간 충전기 상태" 위젯 API의 charger 문서.
 * 온톨로지 정본(operations-cs.function.proactive-fault-detection) 반영:
 *   - 통신 판정은 packetReceivedAt 실측만 (connectionStatus/isConnection 라벨 사용 금지)
 *   - RSRP 0/양수/미보고 = '신호 미보고' 분류만 (단독 승격 금지)
 *   - CPO partnerId=1(플러그링크) 한정, (테스트) 충전소 제외
 * 공개 대시보드 게시물이므로 finalizeItem에서 내부정보(dial 원본·IP)를 제거한다.
 */
import { parseKstTimestamp } from './check_status_recent.js';

export const STATUS_TYPES = ['failedConnection', 'failedUsable', 'isError'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 개시일→오늘 날짜 차이(일). KST 날짜 문자열 전제, 형식 오류는 null */
export function dPlusOf(launchedAt, today) {
  const lymd = String(launchedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lymd) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ''))) return null;
  const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(today) - toUtc(lymd)) / DAY_MS);
}

/** 마지막 패킷 수신 이후 경과 구간. 파싱 불가 시 bucket=null */
export function classifyOutage(packetReceivedAt, refEpochMs) {
  const ts = parseKstTimestamp(packetReceivedAt);
  if (ts == null) return { bucket: null, ms: null };
  const ms = refEpochMs - ts;
  const bucket = ms < HOUR_MS ? 'lt1h' : ms < DAY_MS ? 'h1d24' : ms < 7 * DAY_MS ? 'd1d7' : 'gt7d';
  return { bucket, ms };
}

/** CTN 마스킹 — 공개 대시보드용 (뒤 4자리만) */
export function maskCtn(dial) {
  const s = String(dial ?? '').trim();
  if (!s || s === '-') return null;
  return '****' + s.slice(-4);
}

/** RSRP 0/양수/미보고 = 신호 미보고 (check_commstatus.js와 동일 기준) */
function isSignalUnreported(rsrp) {
  const raw = String(rsrp ?? '').trim();
  if (raw === '' || raw === '-') return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n >= 0;
}

/** devices[] 중 대표 장비 — 마지막 통신이 가장 최근인 것 (교체 이력 대비) */
function pickDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (list.length <= 1) return list[0] ?? null;
  return [...list].sort((a, b) =>
    (parseKstTimestamp(b?.packetReceivedAt) ?? 0) - (parseKstTimestamp(a?.packetReceivedAt) ?? 0))[0];
}

/** API 원시 charger 문서 → 내부 표현. _dial은 모뎀 공유 계산용 — finalizeItem에서 제거 */
export function normalizeItem(rawDoc, type) {
  const dev = pickDevice(rawDoc.devices);
  return {
    chargerId: rawDoc.id,
    deviceId: dev?.deviceId ?? null,
    stationId: rawDoc.station?.id ?? null,
    stationName: rawDoc.station?.name ?? null,
    address: rawDoc.station?.roadNameAddress ?? rawDoc.station?.address ?? null,
    launchedAt: String(rawDoc.launchedAt ?? '').slice(0, 10) || null,
    types: [type],
    operationStatus: rawDoc.operationStatus ?? null,
    packetReceivedAt: rawDoc.packetReceivedAt ?? dev?.packetReceivedAt ?? null,
    deviceStatus: dev?.status ?? null,
    errorCode: dev?.errorCode ?? null,
    signalUnreported: isSignalUnreported(dev?.rsrp),
    cpoPartnerId: rawDoc.cpo?.partnerId ?? null,
    _dial: dev?.dial ?? null
  };
}

/** 3종 목록 병합 — 같은 충전기가 복수 유형이면 types 누적 (STATUS_TYPES 순서 유지) */
export function mergeByCharger(byType) {
  const map = new Map();
  for (const type of STATUS_TYPES) {
    for (const rawDoc of byType[type] ?? []) {
      const prev = map.get(rawDoc.id);
      if (prev) { if (!prev.types.includes(type)) prev.types.push(type); }
      else map.set(rawDoc.id, normalizeItem(rawDoc, type));
    }
  }
  return [...map.values()];
}

/** 추적 대상 필터. CPO 미상(null)은 우리 자산 확증 불가 → 파트너 취급 제외 */
export function filterTracked(items, { today, windowDays = 30 }) {
  const excluded = { partnerCpo: 0, outsideWindow: 0, testStation: 0, noLaunchedAt: 0 };
  const tracked = [];
  for (const it of items) {
    if (it.cpoPartnerId !== 1) { excluded.partnerCpo++; continue; }
    if (/\(\s*테스트\s*\)/.test(it.stationName ?? '')) { excluded.testStation++; continue; }
    const d = dPlusOf(it.launchedAt, today);
    if (d == null) { excluded.noLaunchedAt++; continue; }
    if (d < 0 || d > windowDays) { excluded.outsideWindow++; continue; }
    tracked.push({ ...it, dPlus: d });
  }
  return { tracked, excluded };
}

/**
 * 모뎀 공유 위험 — 동일 dial(CTN) 2대+ 공유 시 거점 동시단절 위험.
 * 분모는 추적 대상이 아닌 '전체 이상 목록'(창 밖 기축 충전기와의 공유도 위험이므로).
 */
export function markSharedModemRisk(tracked, allItems) {
  const count = new Map();
  for (const it of allItems) {
    const d = String(it._dial ?? '').trim();
    if (!d || d === '-') continue;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  for (const it of tracked) {
    const d = String(it._dial ?? '').trim();
    it.sharedModemRisk = !!d && d !== '-' && (count.get(d) ?? 0) >= 2;
  }
  return tracked;
}

/** 공개 게시용 최종 항목 — 내부 필드(_dial, cpoPartnerId) 제거 + CTN 마스킹 */
export function finalizeItem(it, refEpochMs) {
  const isConn = it.types.includes('failedConnection');
  const { bucket, ms } = isConn ? classifyOutage(it.packetReceivedAt, refEpochMs) : { bucket: null, ms: null };
  return {
    chargerId: it.chargerId,
    deviceId: it.deviceId,
    stationId: it.stationId,
    stationName: it.stationName,
    address: it.address,
    launchedAt: it.launchedAt,
    dPlus: it.dPlus,
    types: it.types,
    operationStatus: it.operationStatus,
    packetReceivedAt: it.packetReceivedAt,
    outageBucket: bucket,
    outageMs: ms,
    deviceStatus: it.deviceStatus,
    errorCode: it.errorCode,
    signalUnreported: it.signalUnreported,
    ctnMasked: maskCtn(it._dial),
    sharedModemRisk: !!it.sharedModemRisk
  };
}

/** settle.json 스냅샷 생성 (diff·prevRunAt은 호출측에서 채움) */
export function buildSnapshot({ byType, accumulations, date, slot, runAt, refEpochMs, windowDays = 30, truncated = false }) {
  const all = mergeByCharger(byType);
  const { tracked, excluded } = filterTracked(all, { today: date, windowDays });
  markSharedModemRisk(tracked, all);
  const items = tracked
    .map(it => finalizeItem(it, refEpochMs))
    .sort((a, b) => a.dPlus - b.dPlus || a.chargerId - b.chargerId);
  return {
    runAt, date, slot, windowDays,
    accumulations: accumulations ?? null,
    fetched: { total: all.length, truncated },
    excluded,
    items,
    diff: null,
    prevRunAt: null,
    error: null
  };
}

/** 직전 스냅샷 대비: 신규 진입·복구. 창 이탈(에이징아웃)은 복구로 세지 않는다 */
export function diffSnapshots(prev, next) {
  const prevIds = new Set((prev.items ?? []).map(i => i.chargerId));
  const nextIds = new Set((next.items ?? []).map(i => i.chargerId));
  const newEntries = (next.items ?? [])
    .filter(i => !prevIds.has(i.chargerId))
    .map(i => i.chargerId);
  const gap = Math.max(0, dPlusOf(prev.date, next.date) ?? 0);
  const win = next.windowDays ?? 30;
  const recovered = (prev.items ?? [])
    .filter(i => !nextIds.has(i.chargerId))
    .filter(i => (i.dPlus ?? 0) + gap <= win)
    .map(i => ({ chargerId: i.chargerId, stationName: i.stationName, types: i.types }));
  return { newEntries, recovered };
}
```

- [ ] **Step 4: 테스트 통과 확인**

실행: `node --test tests/test_settle_core.js`
기대: 전건 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/settle_core.js tests/test_settle_core.js
git commit -m "feat(settle): 정착 추적 순수 로직 - 병합/필터/D+N/두절분류/diff"
```

---

### Task 2: `lib/settle_api.js` — API I/O

**Files:**
- Create: `lib/settle_api.js`
- Test: `tests/test_settle_api.js`

**Interfaces:**
- Consumes: Playwright `browserContext` (audit.js의 ctx.browserContext — `newPage()` 사용), 글로벌 `fetch`
- Produces (Task 3이 사용):
  - `extractConnectToken(browserContext, base)` → `Promise<string>` (JWT raw), 실패 시 throw
  - `fetchAccumulations(token, {fetchImpl?})` → `Promise<{failedConnection,failedUsable,isError}>`
  - `fetchStatusDevices(token, statusType, {size=100, maxPages=60, fetchImpl?})` → `Promise<{items: object[], truncated: boolean}>`
  - `fetchLiveSettle(dashboardUrl, {fetchImpl?})` → `Promise<object|null>` (404·오류 시 null)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_settle_api.js` 생성 — `fetchImpl` 주입으로 네트워크 없이 검증:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStatusDevices, fetchAccumulations, fetchLiveSettle } from '../lib/settle_api.js';

// Spring 페이지 응답 흉내: pages[i] = i번째 페이지(1-based) content
function fakeFetch(pages, { record } = {}) {
  return async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    record?.push(url);
    const content = pages[page - 1] ?? [];
    return {
      ok: true, status: 200,
      json: async () => ({ data: { content, totalPages: pages.length, number: page - 1 } })
    };
  };
}

test('fetchStatusDevices: 1-based 페이징으로 전 페이지 수집', async () => {
  const urls = [];
  const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
  const r = await fetchStatusDevices('tok', 'failedConnection', { size: 2, fetchImpl: fakeFetch(pages, { record: urls }) });
  assert.deepEqual(r.items.map(i => i.id), [1, 2, 3]);
  assert.equal(r.truncated, false);
  assert.ok(urls[0].includes('page=1') && urls[1].includes('page=2'), '1-based page 파라미터');
  assert.ok(urls[0].includes('statusType=failedConnection'));
});

test('fetchStatusDevices: maxPages 상한 도달 시 truncated=true', async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]];
  const r = await fetchStatusDevices('tok', 'isError', { maxPages: 2, fetchImpl: fakeFetch(pages) });
  assert.equal(r.items.length, 2);
  assert.equal(r.truncated, true);
});

test('fetchStatusDevices: 페이징 미진행(첫 항목 반복) 시 throw — 파라미터 변경 감지', async () => {
  const same = [[{ id: 7 }], [{ id: 7 }]]; // page 파라미터가 무시되는 상황 재현
  await assert.rejects(
    () => fetchStatusDevices('tok', 'failedUsable', { fetchImpl: fakeFetch(same) }),
    /페이징 미진행/
  );
});

test('fetchStatusDevices: HTTP 오류 throw', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => fetchStatusDevices('tok', 'isError', { fetchImpl: bad }), /HTTP 401/);
});

test('fetchAccumulations: data 반환, 인증 헤더 포함', async () => {
  let seenHeaders = null;
  const f = async (url, opts) => {
    seenHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({ data: { failedConnection: 1, failedUsable: 2, isError: 3 } }) };
  };
  const d = await fetchAccumulations('tokval', { fetchImpl: f });
  assert.equal(d.isError, 3);
  assert.equal(seenHeaders.authorization, 'Bearer tokval');
  assert.equal(seenHeaders['x-channel'], 'PLUGLINK');
});

test('fetchLiveSettle: 404/네트워크 실패 → null', async () => {
  assert.equal(await fetchLiveSettle('https://x', { fetchImpl: async () => ({ ok: false, status: 404 }) }), null);
  assert.equal(await fetchLiveSettle('https://x', { fetchImpl: async () => { throw new Error('net'); } }), null);
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ runAt: 'r' }) });
  assert.deepEqual(await fetchLiveSettle('https://x', { fetchImpl: ok }), { runAt: 'r' });
});
```

- [ ] **Step 2: 테스트 실패 확인**

실행: `node --test tests/test_settle_api.js`
기대: FAIL — `Cannot find module '.../lib/settle_api.js'`

- [ ] **Step 3: 구현 작성**

`lib/settle_api.js` 생성:

```js
/**
 * 실시간 충전기 상태 위젯 API 클라이언트 (search.pluglink.kr).
 *
 * 실측 사실(2026-08-10):
 *   - page 파라미터는 1-based (page=0 → HTTP 400). 응답 number는 0-based.
 *   - size=100 정상 동작. 인증은 connect localStorage 'token'의 JWT(만료 약 24h).
 * fetchImpl 주입은 테스트용 — 운영은 Node 20+ 글로벌 fetch.
 */

const SEARCH_BASE = 'https://search.pluglink.kr/v101/dashboards/status';

function apiHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'x-channel': 'PLUGLINK',
    'x-platform': 'WEB',
    'x-token': 'PLUGLINK'
  };
}

/** 커넥트 SPA localStorage에서 JWT 추출 — ensureSession(로그인 보장) 이후 호출 전제 */
export async function extractConnectToken(browserContext, base) {
  const page = await browserContext.newPage();
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // SPA 부트스트랩 대기
    const token = await page.evaluate(() => localStorage.getItem('token'));
    if (!token || !token.startsWith('eyJ')) {
      throw new Error('connect JWT 추출 실패 — localStorage.token 없음 (로그인 상태 확인 필요)');
    }
    return token;
  } finally { await page.close(); }
}

/** 위젯 3종 카운터 */
export async function fetchAccumulations(token, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${SEARCH_BASE}/accumulations`, { headers: apiHeaders(token) });
  if (!r.ok) throw new Error(`accumulations HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.data) throw new Error('accumulations 응답에 data 없음');
  return j.data;
}

/** 이상 목록 전체 수집 (1-based 페이징). 상한 도달 시 truncated=true — 조용한 절단 금지 */
export async function fetchStatusDevices(token, statusType, { size = 100, maxPages = 60, fetchImpl = fetch } = {}) {
  const items = [];
  let totalPages = 1;
  let prevFirstId = null;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const url = `${SEARCH_BASE}/devices?statusType=${statusType}&size=${size}&page=${page}&field=packetReceivedAt&direction=ASC`;
    const r = await fetchImpl(url, { headers: apiHeaders(token) });
    if (!r.ok) throw new Error(`devices(${statusType}) p${page} HTTP ${r.status}`);
    const d = (await r.json())?.data;
    if (!d || !Array.isArray(d.content)) throw new Error(`devices(${statusType}) p${page} 응답 형식 이상`);
    const firstId = d.content[0]?.id ?? null;
    // page 파라미터가 무시되면 같은 페이지가 반복된다 — 무한 중복 수집 대신 즉시 실패
    if (page > 1 && firstId != null && firstId === prevFirstId) {
      throw new Error(`devices(${statusType}) 페이징 미진행(p${page} 첫 항목 동일) — page 파라미터 확인 필요`);
    }
    prevFirstId = firstId;
    items.push(...d.content);
    totalPages = d.totalPages ?? 1;
  }
  return { items, truncated: totalPages > maxPages };
}

/** 라이브 대시보드의 직전 settle.json — diff 기준. 404·실패는 null(최초 실행 취급) */
export async function fetchLiveSettle(dashboardUrl, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${dashboardUrl}/data/settle.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
```

- [ ] **Step 4: 테스트 통과 확인**

실행: `node --test tests/test_settle_api.js`
기대: 전건 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/settle_api.js tests/test_settle_api.js
git commit -m "feat(settle): 위젯 API 클라이언트 - JWT 추출/1-based 페이징/카운터/라이브 seed"
```

---

### Task 3: `lib/settle.js` 오케스트레이터 + `audit.js` 통합

**Files:**
- Create: `lib/settle.js`
- Modify: `audit.js` (import 블록, `main()` 상단, ctx 생성 조건 `audit.js:107`, step 5 직전 삽입, `dashboardUrl` 선언 이동 `audit.js:362`)

**Interfaces:**
- Consumes: Task 1 `buildSnapshot`/`diffSnapshots`/`STATUS_TYPES`, Task 2 전체, audit.js의 `ctx.browserContext`·`dataDir`·`date`·`slot`
- Produces: `runSettle({browserContext, base, dashboardUrl, dataDir, date, slot, windowDays?, refEpochMs?})` → `Promise<{ok:true, tracked:number, diff:object|null} | {ok:false, error:string}>` — **절대 throw하지 않음**. 부수효과: `<dataDir>/settle.json` 기록

- [ ] **Step 1: `lib/settle.js` 작성** (오케스트레이터는 I/O 조립뿐이라 단위 테스트 없음 — 로직은 Task 1·2에서 검증됨, 전체 경로는 Task 6 dry-run으로 검증)

```js
/**
 * 개시 후 30일 정착 추적(settle) 실행 1회분 — 대시보드 전용(Slack 발송 없음).
 *
 * 절대 밖으로 throw하지 않는다: 실패 시 '직전 성공 내용 + error 필드'로 settle.json을 남겨
 * 대시보드가 "갱신 실패" 배너 + 직전 데이터를 보여주게 한다 (조용한 실패 금지).
 * 직전 성공분은 라이브 대시보드의 settle.json에서 seed한다 (CI는 stateless —
 * audit.js가 live index.json으로 dedup하는 기존 패턴과 동일).
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { extractConnectToken, fetchAccumulations, fetchStatusDevices, fetchLiveSettle } from './settle_api.js';
import { buildSnapshot, diffSnapshots, STATUS_TYPES } from './settle_core.js';

export async function runSettle({ browserContext, base, dashboardUrl, dataDir, date, slot, windowDays = 30, refEpochMs = Date.now() }) {
  const outFile = path.join(dataDir, 'settle.json');
  const prev = await fetchLiveSettle(dashboardUrl);
  // 실패 파일은 '직전 성공 내용 + error'이므로 error만 벗기면 직전 성공분이 복원된다
  let prevGood = null;
  if (prev) {
    const { error: _e, ...rest } = prev;
    if (rest.runAt) prevGood = rest;
  }
  try {
    const token = await extractConnectToken(browserContext, base);
    const accumulations = await fetchAccumulations(token);
    const byType = {};
    let truncated = false;
    for (const t of STATUS_TYPES) {
      const r = await fetchStatusDevices(token, t);
      byType[t] = r.items;
      truncated = truncated || r.truncated;
      if (r.truncated) console.warn(`[settle] ${t} 페이지 상한 도달 — 일부만 수집됨`);
    }
    const snapshot = buildSnapshot({
      byType, accumulations, date, slot,
      runAt: new Date(refEpochMs).toISOString(), refEpochMs, windowDays, truncated
    });
    if (prevGood) {
      snapshot.diff = diffSnapshots(prevGood, snapshot);
      snapshot.prevRunAt = prevGood.runAt ?? null;
    }
    writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    return { ok: true, tracked: snapshot.items.length, diff: snapshot.diff };
  } catch (e) {
    const message = (e?.message ?? String(e)).slice(0, 200);
    const failed = {
      ...(prevGood ?? { items: [], runAt: null }),
      error: { message, failedAt: new Date(refEpochMs).toISOString(), lastSuccessAt: prevGood?.runAt ?? null }
    };
    try { writeFileSync(outFile, JSON.stringify(failed, null, 2)); } catch { /* 쓰기 실패 시 라이브 유지 */ }
    console.error('[settle] 실패 —', message);
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 2: `audit.js` 수정 (4곳)**

(1) import 블록 마지막(`import { checkYeongchaShape } ...` 다음 줄)에 추가:

```js
import { runSettle } from './lib/settle.js';
```

(2) `main()` 상단 `const dryRun = args['dry-run'] === true;` 다음 줄에 추가 (dashboardUrl은 기존 line 362 선언을 이곳으로 이동한 것 — Step (4)에서 원래 줄 삭제):

```js
  const settleOn = args['no-settle'] !== true; // 개시 후 30일 정착 추적 (대시보드 전용) — 기본 ON
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://service-init-audit.vercel.app';
```

(3) ctx 생성 조건(현재 `if (stations.length > 0 || slot === 'evening') {`)을 다음으로 교체:

```js
  //   settle(정착 추적)은 커넥트 JWT가 필요해 morning 0건에도 세션을 만든다 (--no-settle 시 기존 최적화 유지)
  if (stations.length > 0 || slot === 'evening' || settleOn) {
```

같은 분기의 else 로그도 교체: `console.log('[audit] morning 0건 + settle OFF — Playwright 세션 생략');`

(4) 기존 `const dashboardUrl = process.env.DASHBOARD_URL || 'https://service-init-audit.vercel.app';` (step 5 안, 현재 line 362) **삭제**. 그리고 그 직전 — `// 5. 알림 / 저장` 주석 바로 위, 4.5 tomorrow 블록 닫는 `}` 다음 — 에 삽입:

```js
    // 4.8 개시 후 30일 정착 추적(settle) — 대시보드 전용(Slack 발송 없음).
    //     실패는 runSettle 내부에서 흡수(직전 성공분+error로 게시) — 기존 검증·알림·exit code 불변.
    if (settleOn && ctx) {
      const r = await runSettle({
        browserContext: ctx.browserContext,
        base: PLINKCONNECT_BASE,
        dashboardUrl, dataDir, date, slot
      });
      console.log(r.ok
        ? `[settle] 추적 이상 ${r.tracked}건 (신규 ${r.diff?.newEntries?.length ?? '-'} / 복구 ${r.diff?.recovered?.length ?? '-'}) → settle.json`
        : `[settle] 실패 — 대시보드 배너로 표시: ${r.error}`);
    }
```

- [ ] **Step 3: 기존 테스트 회귀 확인**

실행: `npm test`
기대: 기존 + 신규 테스트 전건 PASS

- [ ] **Step 4: 문법·경로 스모크**

실행: `node --check audit.js && node -e "import('./lib/settle.js').then(()=>console.log('import OK'))"` (cwd = 프로젝트 루트)
기대: `import OK`

- [ ] **Step 5: 커밋**

```bash
git add lib/settle.js audit.js
git commit -m "feat(settle): audit 실행에 정착 추적 단계 통합 (--no-settle 옵트아웃)"
```

---

### Task 4: CI seed — 배포 시 settle.json 유실 방지

**Files:**
- Modify: `.github/workflows/service-init-audit.yml` — "Seed dashboard history" step

**Interfaces:**
- Consumes: 라이브 `https://service-init-audit.vercel.app/data/settle.json`
- Produces: 러너 작업트리 `public/data/settle.json` (settle 단계 실패·스킵 시에도 배포에 포함돼 라이브 유지)

배경: Vercel 배포는 작업트리 `public/`을 통째로 올린다. seed는 `index.json`의 `slots[].file`만 받아오므로 settle.json은 잡히지 않는다 → seed에 없으면 **배포마다 settle.json이 라이브에서 사라진다**. `runSettle`이 정상 실행되면 자체적으로 다시 쓰지만, `--no-settle`·settle 이전 단계 crash 대비 이중 방어.

- [ ] **Step 1: seed step 수정**

"Seed dashboard history" step의 `else` 분기, `for f in $(jq ...)` 루프 끝난 뒤 `echo "seeded ..."` 줄 **앞**에 추가:

```bash
            # settle.json은 index.json slots에 안 잡히므로 별도 seed (미존재=최초엔 404 — 무시)
            curl -fsS "$BASE/settle.json" -o public/data/settle.json || rm -f public/data/settle.json
```

- [ ] **Step 2: YAML 문법 확인**

실행: `node -e "console.log(require('fs').readFileSync('.github/workflows/service-init-audit.yml','utf8').includes('settle.json') ? 'OK' : 'MISSING')"`
기대: `OK` (들여쓰기는 주변 라인과 동일한 12칸 유지 — YAML 블록 스칼라 내부 셸 스크립트이므로 셸 문법만 유효하면 됨)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/service-init-audit.yml
git commit -m "ci(settle): seed에 settle.json 추가 - 배포 시 유실 방지"
```

---

### Task 5: 대시보드 패널

**Files:**
- Modify: `public/index.html` (`<div id="summary">` 다음 줄)
- Modify: `public/app.js` (`init()` 안 + 파일 하단 함수 추가)
- Modify: `public/styles.css` (파일 끝에 추가)

**Interfaces:**
- Consumes: `/data/settle.json` (Task 3 산출 스키마), 기존 `escapeHtml`/`linkTag`/`stationUrl` 함수(app.js에 이미 존재)
- Produces: `#settle` 섹션 렌더 (사용자용 UI — 다른 태스크가 소비하지 않음)

- [ ] **Step 1: index.html — 섹션 추가**

`<div id="summary"></div>` 바로 다음 줄에 추가:

```html
  <section id="settle"></section>
```

- [ ] **Step 2: app.js — 로드·렌더 추가**

(a) `init()` 안, `renderSidebar();` 바로 앞에 추가:

```js
  loadSettle(); // 날짜 선택과 무관한 현재 스냅샷 — 비동기 병행
```

주의: `init()`의 첫 try/catch에서 manifest 로드 실패 시 `renderEmpty(); return;`으로 조기 종료된다. settle은 manifest 없이도 보여야 하므로, 같은 호출을 그 두 `return` **앞**에도 넣는다 (총 3곳: catch 안, `if (!r.ok)` 안, 정상 경로).

(b) 파일 하단 `escapeHtml` 함수 위에 추가:

```js
// ── 개시 후 정착 추적 (settle) ──────────────────────────────
const SETTLE_TYPE_LABEL = { failedConnection: '통신미연결', failedUsable: '사용불가', isError: '에러' };
const SETTLE_BUCKET_LABEL = { lt1h: '1h 미만', h1d24: '1h~24h', d1d7: '1~7일', gt7d: '7일+' };

async function loadSettle() {
  const el = document.getElementById('settle');
  if (!el || el.dataset.loaded) return; // 중복 호출 가드
  let d = null;
  try {
    const r = await fetch('/data/settle.json');
    if (r.ok) d = await r.json();
  } catch { /* 파일 없음 → 패널 숨김 */ }
  el.dataset.loaded = '1';
  if (!d) { el.innerHTML = ''; return; }
  renderSettle(el, d);
}

function renderSettle(el, d) {
  const err = d.error
    ? `<div class="settle-error">⚠️ 갱신 실패: ${escapeHtml(d.error.message)} — 마지막 성공: ${d.error.lastSuccessAt ? new Date(d.error.lastSuccessAt).toLocaleString('ko-KR') : '없음'} (아래는 직전 성공 데이터)</div>`
    : '';
  const items = d.items ?? [];
  const acc = d.accumulations;
  const diff = d.diff;
  const head = `
    <div class="slot-title">🩺 개시 후 정착 추적 (D+${d.windowDays ?? 30}) · 이상 ${items.length}건${
      diff ? ` · 신규 ↑${diff.newEntries.length} · 복구 ↓${diff.recovered.length}` : ''}${
      acc ? `<span class="settle-acc"> — 위젯 전체: 통신미연결 ${acc.failedConnection} · 사용불가 ${acc.failedUsable} · 에러 ${acc.isError}</span>` : ''}
    </div>
    <div class="meta">갱신: ${d.runAt ? new Date(d.runAt).toLocaleString('ko-KR') : '?'}${d.fetched?.truncated ? ' · ⚠️ 수집 상한 도달(일부 누락 가능)' : ''}</div>`;
  if (!items.length) {
    el.innerHTML = head + err + `<div class="meta">개시 ${d.windowDays ?? 30}일 이내 이상 충전기 없음 ✅</div>`;
    return;
  }
  const newSet = new Set(diff?.newEntries ?? []);
  const rows = items.map(i => `
    <tr class="${newSet.has(i.chargerId) ? 'settle-new' : ''}">
      <td>D+${i.dPlus}</td>
      <td>${i.stationId ? linkTag(stationUrl(i.stationId), escapeHtml(i.stationName ?? String(i.stationId))) : escapeHtml(i.stationName ?? '?')}</td>
      <td>${escapeHtml(String(i.chargerId))}${i.deviceId ? ` <span class="meta">${escapeHtml(i.deviceId)}</span>` : ''}</td>
      <td>${(i.types || []).map(t => `<span class="settle-badge ${t}">${SETTLE_TYPE_LABEL[t] ?? t}</span>`).join(' ')}</td>
      <td>${i.outageBucket ? escapeHtml(SETTLE_BUCKET_LABEL[i.outageBucket] ?? i.outageBucket) : '-'}${i.sharedModemRisk ? ' <span title="동일 회선(CTN) 공유 — 거점 동시단절 위험">⚠️공유회선</span>' : ''}</td>
      <td>${escapeHtml(i.launchedAt ?? '?')}</td>
      <td>${escapeHtml(i.errorCode ?? '')}</td>
    </tr>`).join('');
  const recoveredNote = diff?.recovered?.length
    ? `<div class="meta">복구됨(직전 대비): ${diff.recovered.map(r => escapeHtml(`${r.stationName ?? r.chargerId}(${r.chargerId})`)).join(', ')}</div>`
    : '';
  el.innerHTML = head + err + `
    <div class="settle-scroll"><table class="settle-table">
      <thead><tr><th>경과</th><th>충전소</th><th>충전기</th><th>이상 유형</th><th>두절 기간</th><th>개시일</th><th>에러코드</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${recoveredNote}`;
}
```

- [ ] **Step 3: styles.css — 파일 끝에 추가**

```css
/* ── 개시 후 정착 추적 (settle) ── */
#settle { margin: 16px 0 24px; }
.settle-acc { font-weight: normal; font-size: 12px; color: #888; }
.settle-error { background: #fdecea; color: #b71c1c; padding: 8px 12px; border-radius: 6px; margin: 8px 0; font-size: 13px; }
.settle-scroll { overflow-x: auto; margin-top: 8px; }
.settle-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.settle-table th, .settle-table td { padding: 6px 10px; border-bottom: 1px solid #e5e5e5; text-align: left; white-space: nowrap; }
.settle-table th { color: #666; font-weight: 600; }
.settle-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 12px; background: #eee; }
.settle-badge.failedConnection { background: #fff3e0; color: #e65100; }
.settle-badge.failedUsable { background: #fdecea; color: #b71c1c; }
.settle-badge.isError { background: #ede7f6; color: #4527a0; }
.settle-new { background: #fffde7; }
```

- [ ] **Step 4: 로컬 렌더 확인 (fixture)**

`public/data/settle.json`에 임시 fixture 작성 (커밋 금지 — 확인 후 삭제):

```json
{
  "runAt": "2026-08-10T08:05:00.000Z", "date": "2026-08-10", "slot": "morning", "windowDays": 30,
  "accumulations": { "failedConnection": 782, "failedUsable": 98, "isError": 81 },
  "fetched": { "total": 961, "truncated": false },
  "excluded": { "partnerCpo": 40, "outsideWindow": 900, "testStation": 1, "noLaunchedAt": 3 },
  "items": [
    { "chargerId": 46869, "deviceId": "PL10207768", "stationId": 10032999, "stationName": "북한산 아이파크", "address": "서울특별시 도봉구", "launchedAt": "2026-08-06", "dPlus": 4, "types": ["failedConnection"], "operationStatus": "OPERATION", "packetReceivedAt": "2026-08-06 21:50:19", "outageBucket": "d1d7", "outageMs": 300000000, "deviceStatus": "Available", "errorCode": null, "signalUnreported": false, "ctnMasked": "****1234", "sharedModemRisk": true },
    { "chargerId": 19751, "deviceId": "PL10202408", "stationId": 10020411, "stationName": "래미안길음센터피스", "address": "서울특별시 성북구", "launchedAt": "2026-07-25", "dPlus": 16, "types": ["failedConnection", "isError"], "operationStatus": "OPERATION", "packetReceivedAt": "2026-07-31 15:11:23", "outageBucket": "gt7d", "outageMs": 900000000, "deviceStatus": "Faulted", "errorCode": "E42", "signalUnreported": true, "ctnMasked": "****5678", "sharedModemRisk": false }
  ],
  "diff": { "newEntries": [46869], "recovered": [{ "chargerId": 111, "stationName": "테스트복구소", "types": ["failedConnection"] }] },
  "prevRunAt": "2026-08-09T08:05:00.000Z", "error": null
}
```

정적 서버로 확인: `npx --yes http-server public -p 8787` → 브라우저에서 `http://localhost:8787` 열어 확인:
- 패널 제목에 "이상 2건 · 신규 ↑1 · 복구 ↓1" 표시
- 46869 행이 노란 배경(settle-new), ⚠️공유회선 표기
- 19751 행에 배지 2개(통신미연결+에러), 에러코드 E42
- 복구 라인에 "테스트복구소(111)"
- 기존 날짜별 검증 UI가 깨지지 않음

추가로 error 배너 확인: fixture에 `"error": {"message":"JWT 추출 실패","failedAt":"2026-08-10T08:05:00.000Z","lastSuccessAt":"2026-08-09T08:05:00.000Z"}` 넣고 새로고침 → 빨간 배너 표시. 확인 후 **fixture 삭제**: `rm public/data/settle.json`

- [ ] **Step 5: 커밋**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(settle): 대시보드 '개시 후 정착 추적' 패널"
```

---

### Task 6: 엔드투엔드 dry-run 검증 + 마무리

**Files:**
- 없음 (검증만; 문제 발견 시 해당 태스크 파일 수정)

**Interfaces:**
- Consumes: Task 1~5 전체. 로컬 `chrome_profile`(커넥트 로그인 세션) 또는 `config/.env`의 PLINKCONNECT_USERNAME/PASSWORD

- [ ] **Step 1: 전체 테스트**

실행: `npm test`
기대: 전건 PASS

- [ ] **Step 2: 실환경 dry-run (배포·Slack 없음)**

실행: `node audit.js --slot=morning --dry-run`
기대 로그 확인 항목:
- `[settle] 추적 이상 N건 (신규 - / 복구 -) → settle.json` (최초 실행이라 diff 없음 → `-`)
- 기존 체크 단계들이 평소처럼 동작 (회귀 없음)
- `EXIT_CODE 0`

- [ ] **Step 3: 산출물 검증**

실행: `node -e "const s=JSON.parse(require('fs').readFileSync('public/data/settle.json','utf8')); console.log('items:',s.items.length,'fetched:',s.fetched.total,'excluded:',JSON.stringify(s.excluded)); const j=JSON.stringify(s); console.log('PII guard:', !j.includes('networkAddress') && !/01\d{8,9}/.test(j) ? 'OK' : 'LEAK!'); console.log('sorted:', s.items.every((x,i,a)=>i===0||a[i-1].dPlus<=x.dPlus) ? 'OK' : 'BAD');"`
기대: `PII guard: OK`, `sorted: OK`, fetched.total이 위젯 카운터 합계(±중복병합)와 대략 일치

- [ ] **Step 4: 실측 교차 확인 (수동, 1회)**

`public/data/settle.json`의 items 중 1건을 골라 플링커넥트에서 해당 충전소 페이지를 열어 실제로 이상 상태인지 확인. `launchedAt`이 30일 이내인지, 커넥트 대시보드 위젯 목록에도 있는지 대조.

- [ ] **Step 5: 임시 산출물 정리 후 최종 커밋·푸시**

dry-run이 만든 `public/data/settle.json`은 로컬 실측본이므로 함께 커밋해도 무방하나, **라이브 diff 기준을 오염시키지 않도록 커밋하지 않는다** (CI 첫 실행이 라이브에 게시): `git checkout -- public/data 2>/dev/null; git clean -f public/data` 후 상태 확인.

```bash
git status --short
git push
```

push 후 다음 정기 실행(08:05/17:05) 또는 GitHub Actions "Run workflow"(force=true 불필요 — settle은 dedup과 무관하게 해당 슬롯 첫 실행에서 게시됨)으로 라이브 확인: `https://service-init-audit.vercel.app`에 패널 표시 + `/data/settle.json` 존재.

---

## Self-Review 결과 (작성 시 수행)

- Spec coverage: 데이터소스/판정규칙/트리거/게시/diff/에러처리/PII/테스트 — Task 1~6에 전부 매핑됨. Slack 미발송은 전역 제약으로 고정.
- Type consistency: `runSettle` 반환 `{ok, tracked, diff}` ↔ audit.js 사용부 일치. bucket 키(`lt1h/h1d24/d1d7/gt7d`) ↔ 프런트 `SETTLE_BUCKET_LABEL` 일치. `fetchStatusDevices` 반환 `{items, truncated}` ↔ settle.js 사용부 일치.
- 알려진 트레이드오프: 오케스트레이터(settle.js)는 단위 테스트 없음 — 조립 로직뿐이며 Task 6 dry-run이 커버. `extractConnectToken`은 Playwright 의존이라 실행 검증만.
