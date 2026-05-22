import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGvizCsv, judgeSheet } from '../lib/check_sheet.js';
import { readFileSync } from 'node:fs';

const csv = readFileSync(new URL('./fixtures/sheet_gviz.csv', import.meta.url), 'utf8');

test('parseGvizCsv: CSV → rows 배열', () => {
  const rows = parseGvizCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['프로젝트ID'], 'abc-uuid');
  assert.equal(rows[0]['BR(서비스개시일)'], '2026-05-22');
});

test('judgeSheet: PASS — 날짜 일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'abc-uuid', '2026-05-22');
  assert.equal(r.status, 'PASS');
});

test('judgeSheet: FAIL — BR열 비어있음', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'def-uuid', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'MISSING');
});

test('judgeSheet: FAIL — 날짜 불일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'ghi-uuid', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'DATE_MISMATCH');
});

test('judgeSheet: SKIP — projectId 행 자체가 시트에 없음', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'missing-id', '2026-05-22');
  assert.equal(r.status, 'SKIP');
});
