import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToCsv, parseSheetUrl, buildGoogleAuth } from '../lib/google_auth.js';
import { parseGvizCsv } from '../lib/check_sheet.js';

test('parseSheetUrl: gviz URL에서 spreadsheetId·gid 추출', () => {
  const { spreadsheetId, gid } = parseSheetUrl(
    'https://docs.google.com/spreadsheets/d/18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI/gviz/tq?tqx=out:csv&gid=300841532'
  );
  assert.equal(spreadsheetId, '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI');
  assert.equal(gid, '300841532');
});

test('rowsToCsv → parseGvizCsv: 컬럼 정렬 왕복 보존 (절대 인덱스 호환)', () => {
  // 데이터 행: A열 projectId URL, E열 이름, F열 주소, BR(69)열 개시일
  const row = new Array(70).fill('');
  row[0] = 'https://connect.pluglink.kr/manage/projects/813/construction';
  row[4] = '고양강촌마을6단지한양아파트_1차';
  row[5] = '경기 고양시 일산동구 중앙로 1130';
  row[69] = '2026-06-05';
  const rows = [['', '1', '2'], row];
  const csv = rowsToCsv(rows);
  const parsed = parseGvizCsv(csv);
  assert.equal(parsed[1][0], row[0]);
  assert.equal(parsed[1][4], row[4]);
  assert.equal(parsed[1][5], row[5]);
  assert.equal(parsed[1][69], row[69]);
});

test('rowsToCsv: 콤마·따옴표·개행 포함 셀 escape', () => {
  const csv = rowsToCsv([['a,b', 'he said "hi"', 'line1\nline2']]);
  // parseGvizCsv는 개행으로 line split → 개행 셀은 gviz와 동일하게 분리됨(메타행에만 발생).
  // 콤마/따옴표 셀은 같은 줄 안에서 정확히 복원되어야 함.
  const firstLine = csv.split('\n')[0];
  const parsed = parseGvizCsv(firstLine);
  assert.equal(parsed[0][0], 'a,b');
  assert.equal(parsed[0][1], 'he said "hi"');
});

test('rowsToCsv: ragged 행 그대로 유지', () => {
  const csv = rowsToCsv([['x'], ['a', 'b', 'c']]);
  const parsed = parseGvizCsv(csv);
  assert.equal(parsed[0].length, 1);
  assert.equal(parsed[1].length, 3);
});

test('rowsToCsv: null/빈 입력 안전', () => {
  assert.equal(rowsToCsv(null), '');
  assert.equal(rowsToCsv([]), '');
  assert.equal(rowsToCsv([[null, undefined, 0]]), ',,0');
});

const FAKE_SA = JSON.stringify({
  client_email: 'svc@proj.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n'
});

test('buildGoogleAuth: 하이브리드(위임 X) — 시트는 SA(임퍼소네이션 없음), Gmail은 OAuth', () => {
  const r = buildGoogleAuth({
    GOOGLE_SA_KEY: FAKE_SA, GMAIL_USER: 'woojung.kim@pluglink.kr',
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'tok'
  });
  assert.equal(r.sheetsMode, 'sa');
  assert.equal(r.gmailMode, 'oauth');
  assert.equal(r.sheetsAuth.email, 'svc@proj.iam.gserviceaccount.com');
  assert.equal(r.sheetsAuth.subject, undefined); // 공유 기반 — 임퍼소네이션 안 함
});

test('buildGoogleAuth: 위임 ON — 시트·Gmail 모두 SA 임퍼소네이션', () => {
  const r = buildGoogleAuth({
    GOOGLE_SA_KEY: FAKE_SA, GOOGLE_DELEGATION: '1', GMAIL_USER: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.sheetsMode, 'sa');
  assert.equal(r.gmailMode, 'sa');
  assert.equal(r.sheetsAuth.subject, 'woojung.kim@pluglink.kr');
  assert.equal(r.gmailAuth.subject, 'woojung.kim@pluglink.kr');
});

test('buildGoogleAuth: SA 키 없으면 시트=browser, gmail=oauth', () => {
  const r = buildGoogleAuth({
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'tok'
  });
  assert.equal(r.sheetsMode, 'browser');
  assert.equal(r.gmailMode, 'oauth');
  assert.equal(r.sheetsAuth, null);
});
