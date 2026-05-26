import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeStatus } from '../lib/check_status.js';

const ok = { chargerId: '54251', deviceId: 'PL10225193', operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: '사용가능' };
const bad = { chargerId: '54252', deviceId: 'PL10225194', operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: '점검중' };
const dead = { chargerId: '54253', deviceId: 'PL10225195', operationStatus: '미개시', deviceStatus: '대기', connectorStatus: '사용불가' };

test('judgeStatus: PASS — 모두 정상', () => {
  const r = judgeStatus([ok]);
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.abnormal, []);
});

test('judgeStatus: WARN — 일부 비정상', () => {
  const r = judgeStatus([ok, bad]);
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.abnormal.length, 1);
  assert.equal(r.evidence.abnormal[0].chargerId, '54252');
});

test('judgeStatus: FAIL — 전부 비정상', () => {
  const r = judgeStatus([bad, dead]);
  assert.equal(r.status, 'FAIL');
});

test('judgeStatus: SKIP — 빈 입력', () => {
  assert.equal(judgeStatus([]).status, 'SKIP');
  assert.equal(judgeStatus(null).status, 'SKIP');
  assert.equal(judgeStatus(undefined).status, 'SKIP');
});
