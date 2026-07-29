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

test('judgeStatus: 충전소 상태 미운영 — 충전기 전부 정상이어도 WARN (3원 전이 누락)', () => {
  const r = judgeStatus([ok], '미운영');
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.stationStatus, '미운영');
  assert.match(r.message, /충전소 상태=미운영.*operateStation/);
});

test('judgeStatus: 충전소 상태 운영이면 기존 판정 유지', () => {
  const r = judgeStatus([ok], '운영');
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.stationStatus, '운영');
  assert.doesNotMatch(r.message, /충전소 상태/);
});

test('judgeStatus: 충전기 FAIL + 충전소 미운영 → FAIL 유지(강등 아님)', () => {
  const r = judgeStatus([bad, dead], '미운영');
  assert.equal(r.status, 'FAIL');
  assert.match(r.message, /충전소 상태=미운영/);
});

test('judgeStatus: stationStatus 미상(null)이면 기존 동작 그대로', () => {
  const r = judgeStatus([ok], null);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.stationStatus, undefined);
});
