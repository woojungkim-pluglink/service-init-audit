import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDay, nextTargetDates, pickTomorrowRows, pickRowsForDates } from '../lib/discover_tomorrow.js';

function mkRow(projectId, addr, br) {
  const c = new Array(70).fill('');
  c[0] = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
  c[5] = addr;
  c[68] = br;
  return c;
}

test('nextDay: 오늘 + 1일', () => {
  assert.equal(nextDay('2026-05-28'), '2026-05-29');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2024-02-28'), '2024-02-29'); // 윤년
});

test('nextTargetDates: 평일은 내일 1개', () => {
  // 2026-05-28(목) → 2026-05-29(금) 단일
  assert.deepEqual(nextTargetDates('2026-05-28'), ['2026-05-29']);
});

test('nextTargetDates: 금요일 실행은 토·일·월 커버', () => {
  // 2026-05-29(금) → 내일 토(05-30) → [토, 일, 월]
  assert.deepEqual(nextTargetDates('2026-05-29'), ['2026-05-30', '2026-05-31', '2026-06-01']);
});

test('nextTargetDates: 토요일 실행은 일·월 커버', () => {
  // 2026-05-30(토) → 내일 일(05-31) → [일, 월]
  assert.deepEqual(nextTargetDates('2026-05-30'), ['2026-05-31', '2026-06-01']);
});

test('pickTomorrowRows: 금요일 실행 시 토·일·월 BR 모두 추출 + initiatedAt 보존', () => {
  const rows = [
    mkRow('100', '서울 ...', '2026-05-29'), // 금(오늘+0은 아님; 대상 아님)
    mkRow('200', '경기 ...', '2026-05-30'), // 토 ✅
    mkRow('300', '부산 ...', '2026-05-31'), // 일 ✅
    mkRow('400', '대전 ...', '2026-06-01'), // 월 ✅
    mkRow('500', '인천 ...', '2026-06-02')  // 화 (대상 아님)
  ];
  const out = pickTomorrowRows(rows, '2026-05-29');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(s => s.projectId), ['200', '300', '400']);
  assert.deepEqual(out.map(s => s.initiatedAt), ['2026-05-30', '2026-05-31', '2026-06-01']);
});

test('pickTomorrowRows: BR == 내일 행만 추출', () => {
  const rows = [
    mkRow('100', '서울 ...', '2026-05-28'), // 오늘
    mkRow('200', '경기 ...', '2026-05-29'), // 내일 ✅
    mkRow('300', '부산 ...', '2026-05-30'), // 모레
    mkRow('400', '대전 ...', ''),            // 빈
    mkRow('500', '인천 ...', '2026-05-29')  // 내일 ✅
  ];
  const out = pickTomorrowRows(rows, '2026-05-28');
  assert.equal(out.length, 2);
  assert.equal(out[0].projectId, '200');
  assert.equal(out[0].address, '경기 ...');
  assert.equal(out[0].initiatedAt, '2026-05-29');
  assert.equal(out[1].projectId, '500');
});

test('pickTomorrowRows: 프로젝트명에 [HM] 있으면 제외', () => {
  const rows = [
    mkRow('200', '경기 ...', '2026-05-29'),                 // 포함
    (() => { const c = mkRow('210', '서울 ...', '2026-05-29'); c[4] = '25년환경부_[HM]현대_1차'; return c; })() // [HM] 제외
  ];
  const out = pickTomorrowRows(rows, '2026-05-28');
  assert.equal(out.length, 1);
  assert.equal(out[0].projectId, '200');
});

test('pickRowsForDates: 지정 날짜(오늘) 행만 추출 — 오늘개시 교차검증용, [HM] 제외', () => {
  const rows = [
    mkRow('100', '서울 ...', '2026-07-29'),
    mkRow('200', '경기 ...', '2026-07-30'),
    (() => { const c = mkRow('300', '부산 ...', '2026-07-29'); c[4] = '[HM]한화프로젝트_1차'; return c; })()
  ];
  const out = pickRowsForDates(rows, ['2026-07-29']);
  assert.equal(out.length, 1);
  assert.equal(out[0].projectId, '100');
  assert.equal(out[0].initiatedAt, '2026-07-29');
});

test('pickTomorrowRows: A열 URL이 깨졌으면 제외', () => {
  const c = new Array(70).fill('');
  c[0] = 'invalid url';
  c[5] = '주소';
  c[68] = '2026-05-29';
  const out = pickTomorrowRows([c], '2026-05-28');
  assert.equal(out.length, 0);
});
