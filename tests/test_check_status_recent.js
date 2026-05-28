import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKstTimestamp, judgeStatusRecent } from '../lib/check_status_recent.js';

test('parseKstTimestamp: KST → epoch ms', () => {
  // 2026-05-28 17:00:00 KST = 2026-05-28 08:00:00 UTC
  const t = parseKstTimestamp('2026-05-28 17:00:00');
  assert.equal(t, Date.UTC(2026, 4, 28, 8, 0, 0));
});

test('parseKstTimestamp: 빈/유효하지 않은 값 → null', () => {
  assert.equal(parseKstTimestamp(''), null);
  assert.equal(parseKstTimestamp(null), null);
  assert.equal(parseKstTimestamp('어제'), null);
});

const ref = parseKstTimestamp('2026-05-28 17:05:00'); // 검증 기준 17:05 KST

test('judgeStatusRecent: PASS — 모두 1시간 이내 통신', () => {
  const chargers = [
    { chargerId: '1', deviceId: 'A', lastCommunication: '2026-05-28 17:01:00' },
    { chargerId: '2', deviceId: 'B', lastCommunication: '2026-05-28 16:30:00' }
  ];
  const r = judgeStatusRecent(chargers, ref);
  assert.equal(r.status, 'PASS');
});

test('judgeStatusRecent: WARN — 일부 1시간 초과', () => {
  const chargers = [
    { chargerId: '1', deviceId: 'A', lastCommunication: '2026-05-28 17:01:00' },
    { chargerId: '2', deviceId: 'B', lastCommunication: '2026-05-28 14:00:00' } // 3시간 전
  ];
  const r = judgeStatusRecent(chargers, ref);
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.stale.length, 1);
  assert.equal(r.evidence.stale[0].chargerId, '2');
});

test('judgeStatusRecent: FAIL — 전부 통신 불량', () => {
  const chargers = [
    { chargerId: '1', deviceId: 'A', lastCommunication: '2026-05-27 17:00:00' } // 어제
  ];
  const r = judgeStatusRecent(chargers, ref);
  assert.equal(r.status, 'FAIL');
});

test('judgeStatusRecent: FAIL — 마지막 통신 시각 비어있음', () => {
  const chargers = [
    { chargerId: '1', deviceId: 'A', lastCommunication: '' }
  ];
  const r = judgeStatusRecent(chargers, ref);
  assert.equal(r.status, 'FAIL');
});

test('judgeStatusRecent: SKIP — 빈 입력', () => {
  assert.equal(judgeStatusRecent([], ref).status, 'SKIP');
});
