import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryText, buildSummaryBlocks } from '../lib/notify.js';

test('buildSummaryBlocks: 유효한 Block Kit 구조 + FAIL/대시보드 포함', () => {
  const blocks = buildSummaryBlocks({
    date: '2026-06-02', slot: 'evening',
    summary: { totalStations: 3, byOverall: { PASS: 1, WARN: 1, FAIL: 1 },
      byCheck: { doc:{PASS:3}, rate:{PASS:3}, status:{PASS:1}, sheet:{PASS:3} } },
    stations: [
      { stationName: 'A아파트', overall: 'FAIL', checks: { doc:{status:'FAIL'}, sheet:{status:'PASS'} } },
      { stationName: 'B빌라', overall: 'WARN', checks: { status:{status:'WARN'} } },
      { stationName: 'C타워', overall: 'PASS', checks: { doc:{status:'PASS'} } }
    ],
    tomorrowStations: [{ stationName: 'D', initiatedAt: '2026-06-03', checks:{status:{status:'PASS'}}, overall:'PASS' }],
    tomorrowSummary: { totalStations: 1, dates: ['2026-06-03'], byOverall:{PASS:1,WARN:0,FAIL:0,SKIP:0} },
    dashboardUrl: 'https://service-init-audit.vercel.app'
  });
  assert.ok(Array.isArray(blocks) && blocks.length >= 4);
  assert.equal(blocks[0].type, 'header');
  assert.ok(blocks[0].text.text.includes('서비스개시 검증'));
  const json = JSON.stringify(blocks);
  assert.match(json, /실패 1건/);
  assert.match(json, /A아파트/);
  assert.match(json, /개시 예정 1건/);
  assert.match(json, /대시보드 열기/);
  // header plain_text ≤150, section text ≤3000 (Slack 한도)
  assert.ok(blocks[0].text.text.length <= 150);
  for (const b of blocks) if (b.type==='section' && b.text) assert.ok(b.text.text.length <= 3000);
});

test('buildSummaryText: FAIL 건 나열 (stations 키)', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'evening',
    summary: {
      totalStations: 5,
      byOverall: { PASS: 2, WARN: 1, FAIL: 2 },
      byCheck: {
        doc:    { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 },
        rate:   { PASS: 5, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 3, WARN: 1, FAIL: 1, SKIP: 0 },
        sheet:  { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 }
      }
    },
    stations: [
      { stationName: 'OO아파트', stationId: '10000001', overall: 'FAIL', checks: {
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

test('buildSummaryText: WARN-only 충전소는 FAIL 목록에 포함되지 않음', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'morning',
    summary: {
      totalStations: 2,
      byOverall: { PASS: 1, WARN: 1, FAIL: 0 },
      byCheck: {
        doc:    { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 },
        rate:   { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 1, WARN: 1, FAIL: 0, SKIP: 0 },
        sheet:  { PASS: 2, WARN: 0, FAIL: 0, SKIP: 0 }
      }
    },
    stations: [
      { stationName: 'AA아파트', overall: 'PASS', checks: { doc:{status:'PASS'}, rate:{status:'PASS'}, status:{status:'PASS'}, sheet:{status:'PASS'} } },
      { stationName: 'BB빌라',   overall: 'WARN', checks: { doc:{status:'PASS'}, rate:{status:'PASS'}, status:{status:'WARN'}, sheet:{status:'PASS'} } }
    ],
    dashboardUrl: 'https://x.app'
  });
  assert.match(text, /FAIL 건 없음/);
  assert.doesNotMatch(text, /BB빌라/);
});

test('buildSummaryText: 원격제어 결과 섹션 렌더', () => {
  const text = buildSummaryText({
    date: '2026-06-01', slot: 'morning',
    summary: { totalStations: 1, byOverall: { PASS: 0, WARN: 1, FAIL: 0 },
      byCheck: { doc:{PASS:1}, rate:{PASS:1}, status:{PASS:0}, sheet:{PASS:1} } },
    stations: [
      { stationName: '화성아파트', overall: 'WARN', checks: { status:{status:'WARN'} },
        remediation: { targets: 1, results: [{ chargerId: '50947', ok: true, executed: true, after: '운영' }] } }
    ],
    dashboardUrl: 'https://x.app'
  });
  assert.match(text, /자동 원격제어\(미운영→운영\) 1건 · 성공 1/);
  assert.match(text, /화성아파트 충전기 50947 → 운영 전환/);
});

test('buildSummaryText: stationName이 없으면 stationId로 fallback', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'morning',
    summary: {
      totalStations: 1,
      byOverall: { PASS: 0, WARN: 0, FAIL: 1 },
      byCheck: {
        doc:    { PASS: 0, WARN: 0, FAIL: 1, SKIP: 0 },
        rate:   { PASS: 1, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 1, WARN: 0, FAIL: 0, SKIP: 0 },
        sheet:  { PASS: 1, WARN: 0, FAIL: 0, SKIP: 0 }
      }
    },
    stations: [
      { stationId: '99999', overall: 'FAIL', checks: { doc:{status:'FAIL'}, rate:{status:'PASS'}, status:{status:'PASS'}, sheet:{status:'PASS'} } }
    ],
    dashboardUrl: 'https://x.app'
  });
  assert.match(text, /99999/);
});
