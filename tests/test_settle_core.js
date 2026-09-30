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

test('diffSnapshots: prev=null(최초 실행) → newEntries만, recovered=빈배열', () => {
  const next = {
    date: '2026-08-10', windowDays: 30,
    items: [
      { chargerId: 1, stationName: 'A', types: ['failedConnection'], dPlus: 5 },
      { chargerId: 2, stationName: 'B', types: ['isError'], dPlus: 10 }
    ]
  };
  const d = diffSnapshots(null, next);
  assert.deepEqual(d.newEntries, [1, 2]);
  assert.deepEqual(d.recovered, []);
});

// ── 일별 스냅샷 (대시보드에서 날짜별로 되돌아보기) ──
import { dailySettleFile, pickPrevDailyFile, buildDailySnapshot } from '../lib/settle_core.js';

test('dailySettleFile: 날짜 접두 파일명 — retention.js 의 YYYY-MM-DD- 규칙에 걸려 90일 후 자동 정리된다', () => {
  assert.equal(dailySettleFile('2026-09-30'), '2026-09-30-settle.json');
  assert.match(dailySettleFile('2026-09-30'), /^\d{4}-\d{2}-\d{2}-/);
});

test('pickPrevDailyFile: 오늘보다 이전의 가장 최근 스냅샷을 고른다 (실행이 빠진 날은 건너뛴다)', () => {
  const files = ['2026-09-26-settle.json', '2026-09-28-settle.json', '2026-09-30-settle.json',
                 '2026-09-28-morning.json', 'settle.json', 'index.json'];
  assert.equal(pickPrevDailyFile(files, '2026-09-30'), '2026-09-28-settle.json');
  assert.equal(pickPrevDailyFile(files, '2026-09-27'), '2026-09-26-settle.json');
});

test('pickPrevDailyFile: 당일 파일은 비교 기준이 아니다 (저녁이 아침과 비교하면 일간 변화가 아니라 반나절 변화가 된다)', () => {
  assert.equal(pickPrevDailyFile(['2026-09-30-settle.json'], '2026-09-30'), null);
  assert.equal(pickPrevDailyFile([], '2026-09-30'), null);
});

const snap = (date, ids) => ({
  date, slot: 'evening', runAt: `${date}T08:00:00Z`, windowDays: 30,
  items: ids.map(id => ({ chargerId: id, stationName: `S${id}`, types: ['isError'], dPlus: 3 })),
  diff: { newEntries: ['vs-prev-run'], recovered: [] }, prevRunAt: 'this-morning'
});

test('buildDailySnapshot: 신규·복구를 "전날 스냅샷" 대비로 다시 계산한다', () => {
  const today = snap('2026-09-30', [1, 3]);
  const prev = snap('2026-09-29', [1, 2]);
  const d = buildDailySnapshot(today, prev);
  assert.deepEqual(d.diff.newEntries, [3]);
  assert.deepEqual(d.diff.recovered.map(r => r.chargerId), [2]);
  assert.equal(d.diffBase, '2026-09-29');
  assert.equal(d.prevRunAt, '2026-09-29T08:00:00Z');
});

test('buildDailySnapshot: 전날 스냅샷이 없으면(기능 첫날) 직전 실행 대비 diff 를 그대로 쓴다', () => {
  const today = snap('2026-09-30', [1]);
  const d = buildDailySnapshot(today, null);
  assert.deepEqual(d.diff, today.diff);
  assert.equal(d.diffBase, 'prev-run');
});

test('buildDailySnapshot: 원본 스냅샷을 변형하지 않는다 (settle.json 최신본은 직전 실행 대비를 유지)', () => {
  const today = snap('2026-09-30', [1, 3]);
  const before = JSON.stringify(today);
  buildDailySnapshot(today, snap('2026-09-29', [1, 2]));
  assert.equal(JSON.stringify(today), before);
});
