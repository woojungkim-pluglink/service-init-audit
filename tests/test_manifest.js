import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertManifest, slotAlreadyDone } from '../lib/manifest.js';

test('slotAlreadyDone: 해당 (date,slot) 있으면 true', () => {
  const m = { slots: [
    { date: '2026-06-08', slot: 'morning' },
    { date: '2026-06-07', slot: 'evening' }
  ]};
  assert.equal(slotAlreadyDone(m, '2026-06-08', 'morning'), true);
  assert.equal(slotAlreadyDone(m, '2026-06-08', 'evening'), false); // 같은 날 다른 슬롯
  assert.equal(slotAlreadyDone(m, '2026-06-07', 'morning'), false);
  assert.equal(slotAlreadyDone({ slots: [] }, '2026-06-08', 'morning'), false);
  assert.equal(slotAlreadyDone(null, '2026-06-08', 'morning'), false);
  assert.equal(slotAlreadyDone({}, '2026-06-08', 'morning'), false);
});

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
