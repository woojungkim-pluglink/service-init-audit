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
