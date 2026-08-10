import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStatusDevices, fetchAccumulations, fetchLiveSettle } from '../lib/settle_api.js';

// Spring 페이지 응답 흉내: pages[i] = i번째 페이지(1-based) content
function fakeFetch(pages, { record } = {}) {
  return async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    record?.push(url);
    const content = pages[page - 1] ?? [];
    return {
      ok: true, status: 200,
      json: async () => ({ data: { content, totalPages: pages.length, number: page - 1 } })
    };
  };
}

test('fetchStatusDevices: 1-based 페이징으로 전 페이지 수집', async () => {
  const urls = [];
  const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
  const r = await fetchStatusDevices('tok', 'failedConnection', { size: 2, fetchImpl: fakeFetch(pages, { record: urls }) });
  assert.deepEqual(r.items.map(i => i.id), [1, 2, 3]);
  assert.equal(r.truncated, false);
  assert.ok(urls[0].includes('page=1') && urls[1].includes('page=2'), '1-based page 파라미터');
  assert.ok(urls[0].includes('statusType=failedConnection'));
});

test('fetchStatusDevices: maxPages 상한 도달 시 truncated=true', async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]];
  const r = await fetchStatusDevices('tok', 'isError', { maxPages: 2, fetchImpl: fakeFetch(pages) });
  assert.equal(r.items.length, 2);
  assert.equal(r.truncated, true);
});

test('fetchStatusDevices: 페이징 미진행(첫 항목 반복) 시 throw — 파라미터 변경 감지', async () => {
  const same = [[{ id: 7 }], [{ id: 7 }]]; // page 파라미터가 무시되는 상황 재현
  await assert.rejects(
    () => fetchStatusDevices('tok', 'failedUsable', { fetchImpl: fakeFetch(same) }),
    /페이징 미진행/
  );
});

test('fetchStatusDevices: HTTP 오류 throw', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => fetchStatusDevices('tok', 'isError', { fetchImpl: bad }), /HTTP 401/);
});

test('fetchAccumulations: data 반환, 인증 헤더 포함', async () => {
  let seenHeaders = null;
  const f = async (url, opts) => {
    seenHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({ data: { failedConnection: 1, failedUsable: 2, isError: 3 } }) };
  };
  const d = await fetchAccumulations('tokval', { fetchImpl: f });
  assert.equal(d.isError, 3);
  assert.equal(seenHeaders.authorization, 'Bearer tokval');
  assert.equal(seenHeaders['x-channel'], 'PLUGLINK');
});

test('fetchLiveSettle: 404/네트워크 실패 → null', async () => {
  assert.equal(await fetchLiveSettle('https://x', { fetchImpl: async () => ({ ok: false, status: 404 }) }), null);
  assert.equal(await fetchLiveSettle('https://x', { fetchImpl: async () => { throw new Error('net'); } }), null);
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ runAt: 'r' }) });
  assert.deepEqual(await fetchLiveSettle('https://x', { fetchImpl: ok }), { runAt: 'r' });
});
