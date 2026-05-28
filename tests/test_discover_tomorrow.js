import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDay, pickTomorrowRows } from '../lib/discover_tomorrow.js';

function mkRow(projectId, addr, br) {
  const c = new Array(70).fill('');
  c[0] = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
  c[5] = addr;
  c[69] = br;
  return c;
}

test('nextDay: 오늘 + 1일', () => {
  assert.equal(nextDay('2026-05-28'), '2026-05-29');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2024-02-28'), '2024-02-29'); // 윤년
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

test('pickTomorrowRows: A열 URL이 깨졌으면 제외', () => {
  const c = new Array(70).fill('');
  c[0] = 'invalid url';
  c[5] = '주소';
  c[69] = '2026-05-29';
  const out = pickTomorrowRows([c], '2026-05-28');
  assert.equal(out.length, 0);
});
