import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEmails } from '../lib/check_doc.js';
import { readFileSync } from 'node:fs';

const { threads } = JSON.parse(readFileSync(new URL('./fixtures/gmail_threads.json', import.meta.url)));
const pmEmails = ['daeyeol.yang@pluglink.kr', 'taekyoon.kim@pluglink.kr', 'chunggeun.kim@pluglink.kr'];

test('matchEmails: PASS — cc:woojung 매칭 메일 발견', () => {
  const r = matchEmails(threads, {
    keywords: ['OO아파트', 'OO아파트 지하주차장'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.matchedEmails.length, 1);
  assert.equal(r.evidence.matchedEmails[0].id, 't1');
});

test('matchEmails: WARN — PM 발신 메일 있지만 cc:me 빠짐', () => {
  const r = matchEmails(threads, {
    keywords: ['ZZ아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'WARN');
});

test('matchEmails: FAIL — 매칭 메일 없음', () => {
  const r = matchEmails(threads, {
    keywords: ['QQ아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'FAIL');
});
