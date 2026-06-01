import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRemediationTargets } from '../lib/remediate_charger.js';

// 기준시각: 2026-06-01 09:00:00 KST = UTC 00:00
const REF = Date.UTC(2026, 5, 1, 0, 0, 0);
const c = (chargerId, deviceStatus, lastComm) => ({ chargerId, deviceId: 'PL' + chargerId, deviceStatus, lastCommunication: lastComm });

test('pickRemediationTargets: 미운영 + 최근(1시간 이내) 통신 → 대상', () => {
  const out = pickRemediationTargets([
    c('1', '미운영', '2026-06-01 08:30:00') // 30분 전 → 대상
  ], REF);
  assert.equal(out.length, 1);
  assert.equal(out[0].chargerId, '1');
});

test('pickRemediationTargets: 운영 상태는 제외', () => {
  const out = pickRemediationTargets([c('2', '운영', '2026-06-01 08:55:00')], REF);
  assert.equal(out.length, 0);
});

test('pickRemediationTargets: 미운영이지만 통신 1시간 초과 → 제외', () => {
  const out = pickRemediationTargets([c('3', '미운영', '2026-06-01 07:30:00')], REF); // 1.5h 전
  assert.equal(out.length, 0);
});

test('pickRemediationTargets: 미운영 + 통신시각 없음 → 제외', () => {
  const out = pickRemediationTargets([c('4', '미운영', '')], REF);
  assert.equal(out.length, 0);
});

test('pickRemediationTargets: 미래 통신시각(음수 age) → 제외', () => {
  const out = pickRemediationTargets([c('5', '미운영', '2026-06-01 09:30:00')], REF);
  assert.equal(out.length, 0);
});

test('pickRemediationTargets: 경계값 정확히 1시간 → 포함', () => {
  const out = pickRemediationTargets([c('6', '미운영', '2026-06-01 08:00:00')], REF); // 정확히 60분
  assert.equal(out.length, 1);
});

test('pickRemediationTargets: 혼합 — 대상만 선별', () => {
  const out = pickRemediationTargets([
    c('a', '운영', '2026-06-01 08:59:00'),
    c('b', '미운영', '2026-06-01 08:40:00'),   // 대상
    c('c', '미운영', '2026-06-01 06:00:00'),   // stale 제외
    c('d', '미운영', '2026-06-01 08:58:00')    // 대상
  ], REF);
  assert.deepEqual(out.map(x => x.chargerId), ['b', 'd']);
});

test('pickRemediationTargets: 빈 입력 안전', () => {
  assert.equal(pickRemediationTargets([], REF).length, 0);
  assert.equal(pickRemediationTargets(null, REF).length, 0);
});
