import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCutoff } from '../lib/date_utils.js';

test('calcCutoff: 90일 전 계산', () => {
  assert.equal(calcCutoff('2026-05-22', 90), '2026-02-21');
});

test('calcCutoff: 1일 전', () => {
  assert.equal(calcCutoff('2026-05-22', 1), '2026-05-21');
});

test('calcCutoff: 윤년 경계 (2024-03-01에서 1일 전 = 2024-02-29)', () => {
  assert.equal(calcCutoff('2024-03-01', 1), '2024-02-29');
});

test('calcCutoff: 0일 = 동일 날짜', () => {
  assert.equal(calcCutoff('2026-05-22', 0), '2026-05-22');
});
