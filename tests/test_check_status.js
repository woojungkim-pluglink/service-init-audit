import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeStatus } from '../lib/check_status.js';

test('judgeStatus: PASS — 모두 정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '사업개시', operationStatus: '운영', useStatus: '사용가능' }
  ]);
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.abnormal, []);
});

test('judgeStatus: WARN — 일부 비정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '사업개시', operationStatus: '운영', useStatus: '사용가능' },
    { deviceId: 'DEV002', businessStatus: '사업개시', operationStatus: '운영', useStatus: '점검중' }
  ]);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.abnormal, ['DEV002']);
});

test('judgeStatus: FAIL — 전부 비정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '미개시', operationStatus: '대기', useStatus: '사용불가' }
  ]);
  assert.equal(r.status, 'FAIL');
});

test('judgeStatus: SKIP — 빈 입력', () => {
  const r = judgeStatus([]);
  assert.equal(r.status, 'SKIP');
});

test('judgeStatus: SKIP — null 입력', () => {
  assert.equal(judgeStatus(null).status, 'SKIP');
});

test('judgeStatus: SKIP — undefined 입력', () => {
  assert.equal(judgeStatus(undefined).status, 'SKIP');
});
