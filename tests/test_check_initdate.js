import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeInitDate } from '../lib/check_initdate.js';

const chg = (id, initiatedAt) => ({ chargerId: id, initiatedAt });
const TODAY = '2026-07-13';

test('judgeInitDate: 전건 정상(오늘/과거 유효날짜) → PASS', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-13'), chg('2', '2022-04-05')] }, TODAY);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.blank + r.evidence.invalid + r.evidence.future, 0);
});

test('judgeInitDate: 공란 → WARN + 공란 충전기 목록', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-13'), chg('2', ''), chg('3', '  ')] }, TODAY);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.blankChargers, ['2', '3']);
  assert.match(r.message, /공란 2기/);
});

test('judgeInitDate: 형식오류(날짜 아님) → WARN', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-13'), chg('2', '개시전'), chg('3', '2026/07/13')] }, TODAY);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.invalidChargers, ['2', '3']);
  assert.match(r.message, /형식오류 2기/);
});

test('judgeInitDate: 미래날짜(개시일 > 실행일) → WARN', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-13'), chg('2', '2026-07-20')] }, TODAY);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.futureChargers, ['2']);
  assert.match(r.message, /미래날짜 1기/);
});

test('judgeInitDate: 여러 오류 유형 동시 → 메시지에 각각 표기', () => {
  const r = judgeInitDate({ chargers: [chg('1', ''), chg('2', 'xxx'), chg('3', '2099-01-01'), chg('4', '2026-07-13')] }, TODAY);
  assert.equal(r.status, 'WARN');
  assert.match(r.message, /공란 1기.*형식오류 1기.*미래날짜 1기/);
  assert.equal(r.evidence.total, 4);
});

test('judgeInitDate: today 없으면 미래 검사 생략(공란/형식만)', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2099-01-01')] });
  assert.equal(r.status, 'PASS'); // 미래 미검사 → 유효 날짜로 통과
});

test('judgeInitDate: 알림 대수 > 개시일==오늘 매칭 대수 → 검증 누락 WARN (옥산해오름 실측 케이스)', () => {
  // Slack 알림은 8기 개시라는데 개시일==오늘 매칭은 6기 → 2기가 검증에서 조용히 빠짐
  const chargers = [
    ...Array.from({ length: 6 }, (_, i) => chg(String(i + 1), TODAY)),
    chg('7', '2026-07-12'), chg('8', '2026-07-12') // 오기재(과거날짜) — 공란/미래가 아니라 기존 검사엔 안 걸림
  ];
  const r = judgeInitDate({ chargers, totalChargers: 8 }, TODAY);
  assert.equal(r.status, 'WARN');
  assert.equal(r.evidence.coverageGap, 2);
  assert.match(r.message, /알림 개시 8기 vs 개시일==오늘 6기/);
});

test('judgeInitDate: enrich 실패 시 알림 대수 교차 생략(중복 경보 방지)', () => {
  const r = judgeInitDate({ chargers: [chg('1', '2026-07-12')], totalChargers: 8, enrichError: 'timeout' }, TODAY);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.coverageGap, 0);
});

test('judgeInitDate: 알림 대수 == 매칭 대수(기축 있어도) → 정상', () => {
  const chargers = [chg('1', TODAY), chg('2', TODAY), chg('3', '2022-04-05')]; // 기축 1기 포함
  const r = judgeInitDate({ chargers, totalChargers: 2 }, TODAY);
  assert.equal(r.status, 'PASS');
});

test('judgeInitDate: 충전기 목록 없음 → SKIP', () => {
  assert.equal(judgeInitDate({ chargers: [] }, TODAY).status, 'SKIP');
  assert.equal(judgeInitDate(null, TODAY).status, 'SKIP');
});
