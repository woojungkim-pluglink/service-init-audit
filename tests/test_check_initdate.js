import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeInitDate } from '../lib/check_initdate.js';

const chg = (id, initiatedAt) => ({ chargerId: id, initiatedAt });

test('judgeInitDate: 전건 기재 → PASS', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-07'), chg('2', '2026-07-07')] });
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.blank, 0);
  assert.match(r.message, /전건 기재/);
});

test('judgeInitDate: 서비스개시일자 공란 있으면 WARN + 공란 충전기 목록', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-07'), chg('2', ''), chg('3', '  ')] });
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.blank, 2);
  assert.equal(r.evidence.total, 3);
  assert.deepEqual(r.evidence.blankChargers, ['2', '3']);
  assert.match(r.message, /공란 2\/3기/);
});

test('judgeInitDate: 충전기 목록 없음 → SKIP', () => {
  assert.equal(judgeInitDate({ chargers: [] }).status, 'SKIP');
  assert.equal(judgeInitDate({}).status, 'SKIP');
  assert.equal(judgeInitDate(null).status, 'SKIP');
});

test('judgeInitDate: initiatedAt undefined/null도 공란 처리', () => {
  const r = judgeInitDate({ chargers: [chg('1', undefined), chg('2', null)] });
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.blank, 2);
});
