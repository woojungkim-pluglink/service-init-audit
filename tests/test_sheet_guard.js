import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkYeongchaShape, rowProjectId } from '../lib/sheet_guard.js';

// 정상 데이터 행 생성: A=프로젝트URL, F(5)=주소, BQ(68)=개시일
function row(pid, addr, initDate) {
  const c = new Array(70).fill('');
  c[0] = `https://connect.pluglink.kr/manage/projects/${pid}/construction`;
  c[5] = addr;
  c[68] = initDate || '';
  return c;
}
function manyRows(n, withDate = true) {
  return Array.from({ length: n }, (_, i) =>
    row(1000 + i, `경기 성남시 어딘가로 ${i}`, withDate ? '2026-06-30' : ''));
}

test('rowProjectId: A열 URL에서 추출', () => {
  assert.equal(rowProjectId(row('27381', '주소', '2026-06-30')), '27381');
  assert.equal(rowProjectId(new Array(70).fill('')), null);
});

test('checkYeongchaShape: 정상 시트는 ok', () => {
  const r = checkYeongchaShape(manyRows(50));
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test('checkYeongchaShape: 개시일 컬럼이 밀려 날짜가 아니면 실패', () => {
  // 컬럼 이동 재현: 68에 날짜 대신 요금명이 들어옴
  const rows = manyRows(50).map(c => { c[68] = '공동주택 고압'; return c; });
  const r = checkYeongchaShape(rows);
  assert.equal(r.ok, false);
  assert.match(r.reason, /개시일|컬럼 이동/);
});

test('checkYeongchaShape: 주소 컬럼이 비면 실패', () => {
  const rows = manyRows(50).map(c => { c[5] = ''; return c; });
  const r = checkYeongchaShape(rows);
  assert.equal(r.ok, false);
});

test('checkYeongchaShape: 데이터 행이 너무 적으면(로드 실패 의심) 실패', () => {
  const r = checkYeongchaShape(manyRows(5));
  assert.equal(r.ok, false);
  assert.match(r.reason, /데이터 행|너무 적/);
});

test('checkYeongchaShape: 개시일 빈 행([HM] 1차 등)이 섞여도 채워진 값이 날짜면 ok', () => {
  // 절반은 개시일 있음(날짜), 절반은 비어있음 — 비어있지 않은 것들이 날짜면 통과
  const withDate = manyRows(40, true);
  const noDate = manyRows(40, false);
  const r = checkYeongchaShape([...withDate, ...noDate]);
  assert.equal(r.ok, true);
});
