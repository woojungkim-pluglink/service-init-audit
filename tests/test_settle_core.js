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
