import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGvizCsv, judgeSheet } from '../lib/check_sheet.js';

// F열(인덱스 5)=주소, BR열(인덱스 69)=서비스개시일.
// 테스트용으로 인덱스 위치까지 채운 wide row 생성 헬퍼.
function mkRow(addr, br) {
  const cells = new Array(70).fill('');
  cells[5] = addr;
  cells[69] = br;
  return cells;
}

test('parseGvizCsv: 헤더 없이 모든 라인을 셀 배열로 반환', () => {
  const csv = '"a","b","c"\n"d","e","f"\n';
  const rows = parseGvizCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['a','b','c']);
});

test('judgeSheet: PASS — F열 주소 + BR열 날짜 일치', () => {
  const rows = [
    mkRow('', ''),
    mkRow('', ''),
    mkRow('충북 충주시 금릉로 101', '2026-05-22')
  ];
  const r = judgeSheet(rows, '충북 충주시 금릉로 101', '2026-05-22');
  assert.equal(r.status, 'PASS');
});

test('judgeSheet: FAIL — BR 비어있음', () => {
  const rows = [mkRow('경기 성남시 중원구 은행로 13', '')];
  const r = judgeSheet(rows, '경기 성남시 중원구 은행로 13', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'MISSING');
});

test('judgeSheet: FAIL — 날짜 불일치', () => {
  const rows = [mkRow('경북 구미시 선기로3길 54', '2026-05-21')];
  const r = judgeSheet(rows, '경북 구미시 선기로3길 54', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'DATE_MISMATCH');
});

test('judgeSheet: SKIP — 행 없음', () => {
  const rows = [mkRow('서울 강남구 테헤란로 1', '2026-05-22')];
  const r = judgeSheet(rows, '제주 제주시 모름로 1', '2026-05-22');
  assert.equal(r.status, 'SKIP');
});

test('judgeSheet: SKIP — 주소 자체가 없음', () => {
  const r = judgeSheet([mkRow('아무거나', '2026-05-22')], '', '2026-05-22');
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.mismatchKind, 'NO_ADDRESS');
});

test('judgeSheet: PARTIAL 매칭 (시트 주소가 더 김)', () => {
  const rows = [mkRow('충북 충주시 금릉로 101 (한아름)', '2026-05-22')];
  const r = judgeSheet(rows, '충북 충주시 금릉로 101', '2026-05-22');
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.matchKind, 'PARTIAL');
});

test('parseGvizCsv: CRLF 응답 처리', () => {
  const crlf = '"a","b"\r\n"c","d"\r\n';
  const rows = parseGvizCsv(crlf);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['a', 'b']);
});

// A열(인덱스 0)=프로젝트 URL, F열(5)=주소, BR열(69)=서비스개시일
function mkRowP(projectId, addr, br) {
  const cells = new Array(70).fill('');
  cells[0] = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
  cells[5] = addr;
  cells[69] = br;
  return cells;
}

test('judgeSheet: 같은 주소 2행 — projectId 매칭 행 우선 (예전 프로젝트 무시)', () => {
  const rows = [
    mkRowP('100', '서울 마포구 새창로8길 72', '2022-12-21'), // 예전 프로젝트
    mkRowP('200', '서울 마포구 새창로8길 72', '2026-05-28')  // 오늘 개시 프로젝트
  ];
  const r = judgeSheet(rows, '서울 마포구 새창로8길 72', '2026-05-28', ['200']);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.sheetProjectId, '200');
  assert.equal(r.evidence.matchedByProjectId, true);
  assert.equal(r.evidence.candidateCount, 2);
});

test('judgeSheet: 같은 주소 2행 — projectId 미일치 시 BR==today 행 우선', () => {
  const rows = [
    mkRowP('100', '서울 마포구 새창로8길 72', '2022-12-21'),
    mkRowP('200', '서울 마포구 새창로8길 72', '2026-05-28')
  ];
  // projectIds 비어있음 → BR==today(2026-05-28) 행이 우선 선택
  const r = judgeSheet(rows, '서울 마포구 새창로8길 72', '2026-05-28', []);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.brValue, '2026-05-28');
});
