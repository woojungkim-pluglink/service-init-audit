import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertManifest } from '../lib/manifest.js';

test('upsertManifest: 새 슬롯 추가', () => {
  const m = { lastUpdated: '2026-05-21T18:00:00+09:00', slots: [] };
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: '2026-05-22-morning.json',
    summary: { totalProjects: 3, byOverall: { PASS: 3 } }
  });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].date, '2026-05-22');
});

test('upsertManifest: 같은 (date, slot) 덮어쓰기', () => {
  const m = { lastUpdated: '', slots: [
    { date: '2026-05-22', slot: 'morning', file: 'x.json', summary: { totalProjects: 1 } }
  ]};
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: '2026-05-22-morning.json',
    summary: { totalProjects: 3 }
  });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].summary.totalProjects, 3);
});

test('upsertManifest: 90일 초과 제거', () => {
  const m = { lastUpdated: '', slots: [
    { date: '2025-01-01', slot: 'morning', file: 'old.json', summary: {} }
  ]};
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: 'new.json', summary: {}
  }, { retentionDays: 90, today: '2026-05-22' });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].file, 'new.json');
});
