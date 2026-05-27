import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEmails, subtractDays } from '../lib/check_doc.js';
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

test('matchEmails: PASS 시 gmailUrl이 threadId 사용', () => {
  const r = matchEmails(threads, {
    keywords: ['OO아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'PASS');
  assert.match(r.evidence.matchedEmails[0].gmailUrl, /#inbox\/tt1$/);
});

test('subtractDays: 30일 빼기', () => {
  assert.equal(subtractDays('2026-05-22', 30), '2026-04-22');
});

test('matchEmails: PASS — To에 그룹 메일 (display name 형식)', () => {
  const threadsWithGroup = [{
    id: 'g1', threadId: 'gg1',
    subject: '[플러그링크] 주은아파트 서비스개시 안내',
    from: '"양대열 매니저(사업개발팀)" <daeyeol.yang@pluglink.kr>',
    to: ['관리실@xxx.com', '"PM팀" <pm@pluglink.kr>', '"플러그링크ONM" <OnM@pluglink.kr>'],
    cc: [],
    date: '2026-05-27T10:00:00+09:00',
    snippet: '주은아파트 충전기 서비스개시 안내드립니다'
  }];
  const r = matchEmails(threadsWithGroup, {
    keywords: ['주은아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr',
    groupEmails: ['pm@pluglink.kr']
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.matchedEmails.length, 1);
});

test('matchEmails: WARN — 그룹 메일 없고 본인도 없음 (키워드만 매칭)', () => {
  const threadsNoGroup = [{
    id: 'n1', threadId: 'nn1',
    subject: '[플러그링크] 외부아파트 안내',
    from: 'daeyeol.yang@pluglink.kr',
    to: ['someone@external.com'],
    cc: [],
    date: '2026-05-27T10:00:00+09:00',
    snippet: '외부아파트 안내'
  }];
  const r = matchEmails(threadsNoGroup, {
    keywords: ['외부아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr',
    groupEmails: ['pm@pluglink.kr']
  });
  assert.equal(r.status, 'WARN');
});
