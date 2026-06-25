import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryText } from '../lib/notify.js';

test('buildSummaryText: 건수/드라이런 태그', () => {
  const t = buildSummaryText({
    written: [{ station: '송추우리마을', ticketId: '547438', date: '2026-01-22' }],
    waiting: [], noImage: [], errors: [], dryRun: true,
  });
  assert.match(t, /\[드라이런\]/);
  assert.match(t, /J열 기입: \*1건\*/);
  assert.match(t, /송추우리마을 \(T-547438\) → 2026-01-22/);
});
