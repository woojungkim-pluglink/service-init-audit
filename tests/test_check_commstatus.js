import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCommStatus, isDisconnected } from '../lib/check_commstatus.js';

const chg = (id, connectorStatus) => ({ chargerId: id, connectorStatus });

test('isDisconnected: 통신미연결 표기 흔들림 흡수', () => {
  assert.equal(isDisconnected('통신미연결'), true);
  assert.equal(isDisconnected('통신 미연결'), true);
  assert.equal(isDisconnected('사용가능'), false);
  assert.equal(isDisconnected('충전중'), false);
  assert.equal(isDisconnected(''), false);
});

test('judgeCommStatus: 통신미연결 없으면 PASS', () => {
  const r = judgeCommStatus({ chargers: [chg('1', '사용가능'), chg('2', '충전중')] });
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.disconnected, 0);
});

test('judgeCommStatus: 통신미연결 있으면 WARN + 충전기 ID 목록', () => {
  const r = judgeCommStatus({ chargers: [chg('1', '사용가능'), chg('2', '통신미연결'), chg('3', '통신 미연결')] });
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.disconnected, 2);
  assert.equal(r.evidence.total, 3);
  assert.deepEqual(r.evidence.disconnectedChargers, ['2', '3']);
  assert.match(r.message, /통신미연결 2\/3기/);
});

test('judgeCommStatus: 충전기 없음 → SKIP', () => {
  assert.equal(judgeCommStatus({ chargers: [] }).status, 'SKIP');
  assert.equal(judgeCommStatus(null).status, 'SKIP');
});
