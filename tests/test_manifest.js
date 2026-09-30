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

// ── 정착 추적 일별 스냅샷 색인 (index.json 의 settle 배열) ──
import { upsertSettleIndex } from '../lib/manifest.js';

test('upsertManifest: 기존 settle 색인을 보존한다 (slots 갱신이 settle 을 지우면 CI seed 가 스냅샷을 못 받아 이력 소실)', () => {
  const m = { slots: [], settle: [{ date: '2026-09-29', file: '2026-09-29-settle.json', tracked: 8 }] };
  const r = upsertManifest(m, { date: '2026-09-30', slot: 'morning', file: '2026-09-30-morning.json' },
    { today: '2026-09-30', now: 'X' });
  assert.deepEqual(r.settle, [{ date: '2026-09-29', file: '2026-09-29-settle.json', tracked: 8 }]);
});

test('upsertManifest: settle 색인에도 보존기간을 적용한다', () => {
  const m = { slots: [], settle: [
    { date: '2026-06-01', file: '2026-06-01-settle.json' },
    { date: '2026-09-29', file: '2026-09-29-settle.json' }
  ]};
  const r = upsertManifest(m, { date: '2026-09-30', slot: 'morning', file: 'f' },
    { today: '2026-09-30', retentionDays: 90, now: 'X' });
  assert.deepEqual(r.settle.map(s => s.date), ['2026-09-29']);
});

test('upsertSettleIndex: 같은 날짜는 덮어쓴다 (저녁 실행이 아침 스냅샷을 대체 = 그날의 최종 상태)', () => {
  const m = { slots: [], settle: [{ date: '2026-09-30', file: '2026-09-30-settle.json', tracked: 5 }] };
  const r = upsertSettleIndex(m, { date: '2026-09-30', file: '2026-09-30-settle.json', tracked: 7 });
  assert.equal(r.settle.length, 1);
  assert.equal(r.settle[0].tracked, 7);
});

test('upsertSettleIndex: 날짜 오름차순 정렬, slots 는 건드리지 않는다', () => {
  const m = { slots: [{ date: '2026-09-30', slot: 'morning' }], settle: [{ date: '2026-09-30', file: 'b' }] };
  const r = upsertSettleIndex(m, { date: '2026-09-28', file: 'a' });
  assert.deepEqual(r.settle.map(s => s.date), ['2026-09-28', '2026-09-30']);
  assert.deepEqual(r.slots, m.slots);
});

test('upsertSettleIndex: settle 키가 없던 옛 매니페스트도 받아준다', () => {
  const r = upsertSettleIndex({ slots: [] }, { date: '2026-09-30', file: '2026-09-30-settle.json' });
  assert.equal(r.settle.length, 1);
});
