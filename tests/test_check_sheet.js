import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGvizCsv, judgeSheet } from '../lib/check_sheet.js';

const csv = `"행","주소","서비스개시일","기타"
"2","충북 충주시 금릉로 101","2026-05-22","x"
"3","경기 성남 중원구 두산위브길 123","","y"
"4","경북 구미 금오산어울림로 5","2026-05-21","z"
`;

test('parseGvizCsv: CSV → rows 배열', () => {
  const rows = parseGvizCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['주소'], '충북 충주시 금릉로 101');
});

test('judgeSheet: PASS — 주소 일치 + 날짜 일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), '충북 충주시 금릉로 101', '2026-05-22');
  assert.equal(r.status, 'PASS');
});

test('judgeSheet: FAIL — BR 비어있음', () => {
  const r = judgeSheet(parseGvizCsv(csv), '경기 성남 중원구 두산위브길 123', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'MISSING');
});

test('judgeSheet: FAIL — 날짜 불일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), '경북 구미 금오산어울림로 5', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'DATE_MISMATCH');
});

test('judgeSheet: SKIP — 행 없음', () => {
  const r = judgeSheet(parseGvizCsv(csv), '제주 제주시 모름로 1', '2026-05-22');
  assert.equal(r.status, 'SKIP');
});

test('judgeSheet: SKIP — 주소 자체가 없음', () => {
  const r = judgeSheet(parseGvizCsv(csv), '', '2026-05-22');
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.mismatchKind, 'NO_ADDRESS');
});

test('judgeSheet: PARTIAL 매칭 (시트 주소가 더 김)', () => {
  const rows = parseGvizCsv('"행","주소","서비스개시일"\n"2","충북 충주시 금릉로 101 (한아름)","2026-05-22"\n');
  const r = judgeSheet(rows, '충북 충주시 금릉로 101', '2026-05-22');
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.matchKind, 'PARTIAL');
});

test('parseGvizCsv: CRLF 응답 처리', () => {
  const crlf = '"행","주소","서비스개시일"\r\n"2","서울 강남구 테헤란로 1","2026-05-22"\r\n';
  const rows = parseGvizCsv(crlf);
  assert.equal(rows[0]['서비스개시일'], '2026-05-22');
});
