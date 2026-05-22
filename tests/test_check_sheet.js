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

test('parseGvizCsv: CRLF 응답도 정상 파싱 (라인 끝 \\r 제거)', () => {
  const crlfCsv = '"행","프로젝트ID","BR(서비스개시일)"\r\n"2","abc-uuid","2026-05-22"\r\n';
  const rows = parseGvizCsv(crlfCsv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['BR(서비스개시일)'], '2026-05-22');
  assert.equal(rows[0]['프로젝트ID'], 'abc-uuid');
});

test('judgeSheet: CRLF 입력에서도 PASS 정상 판정', () => {
  const crlfCsv = '"행","프로젝트ID","BR(서비스개시일)"\r\n"2","x","2026-05-22"\r\n';
  const rows = parseGvizCsv(crlfCsv);
  const r = judgeSheet(rows, 'x', '2026-05-22');
  assert.equal(r.status, 'PASS');
});
