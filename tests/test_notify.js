import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryText } from '../lib/notify.js';

test('buildSummaryText: FAIL 건 나열', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'evening',
    summary: {
      totalProjects: 5,
      byOverall: { PASS: 2, WARN: 1, FAIL: 2 },
      byCheck: {
        doc:    { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 },
        rate:   { PASS: 5, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 3, WARN: 1, FAIL: 1, SKIP: 0 },
        sheet:  { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 }
      }
    },
    projects: [
      { projectName: 'OO아파트', overall: 'FAIL', checks: {
        doc: { status: 'FAIL' }, rate: { status: 'PASS' },
        status: { status: 'WARN' }, sheet: { status: 'FAIL' }
      }}
    ],
    dashboardUrl: 'https://service-init-audit.vercel.app'
  });
  assert.match(text, /총 5건/);
  assert.match(text, /OO아파트 \(공문 FAIL, 시트 FAIL\)/);
  assert.match(text, /service-init-audit\.vercel\.app/);
});

test('buildSummaryText: WARN-only 프로젝트는 FAIL 목록에 포함되지 않음', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'morning',
    summary: {
      totalProjects: 2,
      byOverall: { PASS: 1, WARN: 1, FAIL: 0 },
      byCheck: {
        doc:    { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 },
        rate:   { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 1, WARN: 1, FAIL: 0, SKIP: 0 },
        sheet:  { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 }
      }
    },
    projects: [
      { projectName: 'AA아파트', overall: 'PASS', checks: { doc:{status:'PASS'}, rate:{status:'PASS'}, status:{status:'PASS'}, sheet:{status:'PASS'} } },
      { projectName: 'BB빌라',   overall: 'WARN', checks: { doc:{status:'PASS'}, rate:{status:'PASS'}, status:{status:'WARN'}, sheet:{status:'PASS'} } }
    ],
    dashboardUrl: 'https://x.app'
  });
  assert.match(text, /FAIL 건 없음/);
  assert.doesNotMatch(text, /BB빌라/);
});
