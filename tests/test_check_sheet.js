import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGvizCsv, judgeSheet, findProjectNameByProjectIds } from '../lib/check_sheet.js';

// A열(0)=프로젝트 URL, E열(4)=프로젝트명, BQ열(68)=개시일
function mkProjRow(projectId, projectName, br) {
  const c = new Array(70).fill('');
  c[0] = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
  c[4] = projectName;
  c[68] = br || '';
  return c;
}

test('findProjectNameByProjectIds: 주소 없어도 projectId로 [HM] 잡음 (삼계현대 케이스)', () => {
  const rows = [
    mkProjRow('24999', '[HM]창원 마산회원 삼계현대아파트_2차', '2026-06-02'),
    mkProjRow('21217', '구버전아파트', '2025-01-01')
  ];
  assert.equal(
    findProjectNameByProjectIds(rows, ['25000', '24999', '21217'], '2026-06-02'),
    '[HM]창원 마산회원 삼계현대아파트_2차'
  );
});

test('findProjectNameByProjectIds: HM 1차 + 비HM 2차 → 오늘 개시(BR) 비HM 우선', () => {
  const rows = [
    mkProjRow('25302', '[HM]경북 구미 금오산어울림2단지_1차', '2025-03-01'),
    mkProjRow('26696', '25년환경부_경북 구미 금오산어울림2단지_2차', '2026-06-02')
  ];
  assert.equal(
    findProjectNameByProjectIds(rows, ['26696', '25302'], '2026-06-02'),
    '25년환경부_경북 구미 금오산어울림2단지_2차'
  );
});

test('findProjectNameByProjectIds: BR 없는 [HM] 행만 있으면 [HM] 반환(제외 대상)', () => {
  // 삼계현대 실제 케이스: [HM] 행들 모두 BR 비어있음
  const rows = [
    mkProjRow('24999', '[HM]창원 마산회원 삼계현대아파트_2차', ''),
    mkProjRow('25000', '[HM]창원 마산회원 삼계현대아파트_3차', '')
  ];
  const pn = findProjectNameByProjectIds(rows, ['25000', '24999'], '2026-06-02');
  assert.match(pn, /\[HM\]창원 마산회원 삼계현대/);
});

test('findProjectNameByProjectIds: HM(BR없음) + 환경부(BR있음) → 환경부 반환(포함)', () => {
  // 강변보성타운 실제 케이스: 환경부 행에만 BR이 있음
  const rows = [
    mkProjRow('25362', '[HM]경북 구미 강변보성타운 1_1차', ''),
    mkProjRow('25764', '25년환경부_강변보성타운_1차(대기1002,접수8/29)', '2026-03-03')
  ];
  const pn = findProjectNameByProjectIds(rows, ['25764', '25362'], '2026-06-02');
  assert.match(pn, /25년환경부_강변보성타운/);
});

test('findProjectNameByProjectIds: 매칭 없으면 null', () => {
  assert.equal(findProjectNameByProjectIds([mkProjRow('999', 'x', '')], ['111'], '2026-06-02'), null);
  assert.equal(findProjectNameByProjectIds([], ['111'], '2026-06-02'), null);
});

// F열(인덱스 5)=주소, BQ열(인덱스 68)=서비스개시일.
// 테스트용으로 인덱스 위치까지 채운 wide row 생성 헬퍼.
function mkRow(addr, br) {
  const cells = new Array(70).fill('');
  cells[5] = addr;
  cells[68] = br;
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

test('judgeSheet: 시도 약자/풀네임 매칭 (세종특별자치시 ↔ 세종)', () => {
  // 시트 F열은 "세종 부강면 ...", 플링커넥트는 "세종특별자치시 부강면 ..."
  const c = new Array(70).fill('');
  c[0] = 'https://connect.pluglink.kr/manage/projects/26702/construction';
  c[5] = '세종 부강면 부강3길 29-11';
  c[68] = '2026-05-28';
  const r = judgeSheet([c], '세종특별자치시 부강면 부강3길 29-11', '2026-05-28', ['26702']);
  assert.equal(r.status, 'PASS');
});

test('judgeSheet: 시도 약자 — 충북/충남/전북 등', () => {
  const mk = (full) => {
    const c = new Array(70).fill('');
    c[5] = full + ' 어딘가로 1';
    c[68] = '2026-05-28';
    return c;
  };
  const rows = [mk('충북'), mk('충남'), mk('전북')];
  // 풀네임으로 쿼리해도 매칭
  assert.equal(judgeSheet(rows, '충청북도 어딘가로 1', '2026-05-28').status, 'PASS');
  assert.equal(judgeSheet(rows, '충청남도 어딘가로 1', '2026-05-28').status, 'PASS');
  assert.equal(judgeSheet(rows, '전라북도 어딘가로 1', '2026-05-28').status, 'PASS');
});

// A열(인덱스 0)=프로젝트 URL, F열(5)=주소, BQ열(68)=서비스개시일
function mkRowP(projectId, addr, br) {
  const cells = new Array(70).fill('');
  cells[0] = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
  cells[5] = addr;
  cells[68] = br;
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

test('judgeSheet: projectId가 과거+현재 둘 다 매칭 — BR==today 행 우선 (현대2차 케이스)', () => {
  const rows = [
    mkRowP('3451', '서울 마포구 새창로8길 72', '2022-12-21'),  // 예전
    mkRowP('27294', '서울 마포구 새창로8길 72', '2026-05-28')  // 오늘 개시
  ];
  // 충전소 projectIds에 둘 다 있음 → projectId 매칭 후보 2개 중 BR==today 행 선택
  const r = judgeSheet(rows, '서울 마포구 새창로8길 72', '2026-05-28', ['27294', '3451']);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.sheetProjectId, '27294');
});
