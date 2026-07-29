import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCommStatus, isDisconnectedLabel } from '../lib/check_commstatus.js';

// 기준시각: 2026-07-13 09:00:00 KST
const REF = Date.UTC(2026, 6, 13, 0, 0, 0);
const chg = (id, over = {}) => ({
  chargerId: id, connectorStatus: '사용가능', commStatus: '연결',
  rsrp: '-95', ctn: '01011112222', lastCommunication: '2026-07-13 08:50:00', ...over
});

test('isDisconnectedLabel: 미연결 판별 (다구 연접 포함)', () => {
  assert.equal(isDisconnectedLabel('미연결'), true);
  assert.equal(isDisconnectedLabel('연결미연결'), true); // 다구 중 하나 미연결
  assert.equal(isDisconnectedLabel('연결'), false);
  assert.equal(isDisconnectedLabel(''), false);
  assert.equal(isDisconnectedLabel(undefined), false);
});

test('judgeCommStatus: 전건 최근 통신 → PASS', () => {
  const r = judgeCommStatus({ chargers: [chg('1'), chg('2')] }, REF);
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.stale, []);
  assert.deepEqual(r.evidence.earlyWarning, []);
});

test('judgeCommStatus: 시각 1시간 초과 → 라벨이 연결이어도 WARN (SoT=시각)', () => {
  const r = judgeCommStatus({ chargers: [chg('1'), chg('2', { lastCommunication: '2026-07-13 06:00:00' })] }, REF);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.stale, ['2']);
  assert.match(r.message, /통신 1시간 초과 1기\(2\)/);
});

test('judgeCommStatus: 라벨 미연결 + 시각 최근 → 불일치 WARN(labelOnly)', () => {
  const r = judgeCommStatus({ chargers: [chg('1', { commStatus: '미연결' })] }, REF);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.labelOnly, ['1']);
  assert.match(r.message, /라벨 미연결\(통신은 최근\)/);
});

test('judgeCommStatus: 30분~1시간 → 조기경보만(PASS 유지)', () => {
  const r = judgeCommStatus({ chargers: [chg('1', { lastCommunication: '2026-07-13 08:15:00' })] }, REF);
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.earlyWarning, ['1']);
  assert.match(r.message, /조기경보\(30분 초과\) 1기/);
});

test('judgeCommStatus: 실덤프 행 재현 — 사용불가/미연결/RSRP 0/CTN "-"/전일 통신 → WARN + 신호미보고 분류', () => {
  const r = judgeCommStatus({ chargers: [chg('61136', {
    connectorStatus: '사용불가', commStatus: '미연결', rsrp: '0', ctn: '-', lastCommunication: '2026-07-12 11:52:28'
  })] }, REF);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.stale, ['61136']);
  assert.ok(r.evidence.noSignal.includes('61136')); // RSRP=0 → 신호 미보고(가드 분류)
});

test('judgeCommStatus: 모뎀 공유(동일 CTN 2대+) 중 단절 → 거점 동시단절 위험 병기', () => {
  const shared = { ctn: '01222876227' };
  const r = judgeCommStatus({ chargers: [
    chg('1', shared), chg('2', { ...shared, lastCommunication: '2026-07-13 05:00:00' }), chg('3')
  ] }, REF);
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.sharedModemRisk.length, 1);
  assert.equal(r.evidence.sharedModemRisk[0].ctn, '01222876227');
  assert.match(r.message, /모뎀 공유 회선 01222876227.*거점 동시단절 위험/);
});

test('judgeCommStatus: 통신시각 파싱불가 + 라벨 미연결 → labelOnly로 WARN', () => {
  const r = judgeCommStatus({ chargers: [chg('1', { commStatus: '미연결', lastCommunication: '-' })] }, REF);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.labelOnly, ['1']);
});

test('judgeCommStatus: 충전기 없음 → SKIP', () => {
  assert.equal(judgeCommStatus({ chargers: [] }, REF).status, 'SKIP');
  assert.equal(judgeCommStatus(null, REF).status, 'SKIP');
});
