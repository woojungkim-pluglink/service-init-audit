import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEmails, subtractDays, nameVariants, maskEmail, longestCommonSubstringLen } from '../lib/check_doc.js';
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

test('longestCommonSubstringLen: 최장 공통 부분문자열 길이', () => {
  assert.equal(longestCommonSubstringLen('김포힐스테이트리버시티1단지', '플러그링크 힐스테이트리버시티 입주자'), 9);
  assert.equal(longestCommonSubstringLen('abc', 'xyz'), 0);
  assert.equal(longestCommonSubstringLen('', 'x'), 0);
});

test('matchEmails: 지역명/단지번호 생략 제목도 LCS로 PASS (김포힐스테이트 실사례 — 김충근 발송)', () => {
  const t = [{
    id: '1', threadId: 'k1', from: 'chunggeun.kim@pluglink.kr',
    subject: '[플러그링크] 힐스테이트리버시티 입주자대표회의 서비스 개시 안내',
    to: ['x@daum.net'], cc: ['"PM팀" <pm@pluglink.kr>'], date: '2026-07-10', snippet: '개시 안내'
  }];
  const keywords = ['김포힐스테이트리버시티1단지', '김포힐스테이트리버시티1', '경기 김포시 고촌읍'];
  const r = matchEmails(t, { keywords, pmEmails: ['chunggeun.kim@pluglink.kr'], myEmail: 'woojung.kim@pluglink.kr', groupEmails: ['pm@pluglink.kr'] });
  assert.equal(r.status, 'PASS');
});

test('matchEmails: LCS로도 무관한 제목은 매칭 안 됨(오탐 방지)', () => {
  const t = [{
    id: '1', threadId: 'z1', from: 'chunggeun.kim@pluglink.kr',
    subject: '[플러그링크] 세종아파트 서비스 개시 안내', to: [], cc: ['pm@pluglink.kr'], date: '2026-07-10', snippet: ''
  }];
  const keywords = ['김포힐스테이트리버시티1단지', '경기 김포시 고촌읍'];
  const r = matchEmails(t, { keywords, pmEmails: ['chunggeun.kim@pluglink.kr'], myEmail: 'woojung.kim@pluglink.kr', groupEmails: ['pm@pluglink.kr'] });
  assert.equal(r.status, 'FAIL');
});

test('maskEmail: 로컬파트 앞 2자만 남김', () => {
  assert.equal(maskEmail('daeyeol.yang@pluglink.kr'), 'da***@pluglink.kr');
  assert.equal(maskEmail('"PM팀" <pm@pluglink.kr>'), 'pm***@pluglink.kr');
  assert.equal(maskEmail(''), '');
});

test('matchEmails: PASS 증거에 외부 to/cc 미포함 + from 마스킹 (공개 대시보드 PII 최소화)', () => {
  const t = [{
    id: '1', threadId: 't1', subject: '[플러그링크] OO아파트 서비스개시',
    from: 'daeyeol.yang@pluglink.kr', to: ['customer@daum.net'], cc: ['"PM팀" <pm@pluglink.kr>'],
    date: '2026-07-01', snippet: 'OO아파트 개시'
  }];
  const r = matchEmails(t, { keywords: ['OO아파트'], pmEmails: ['daeyeol.yang@pluglink.kr'], myEmail: 'woojung.kim@pluglink.kr', groupEmails: ['pm@pluglink.kr'] });
  assert.equal(r.status, 'PASS');
  const m = r.evidence.matchedEmails[0];
  assert.equal(m.to, undefined);
  assert.equal(m.cc, undefined);
  assert.equal(m.from, 'da***@pluglink.kr');
  assert.ok(!JSON.stringify(r.evidence).includes('customer@daum.net'), '외부 고객 이메일이 evidence에 없어야 함');
});

test('nameVariants: 차수 위치/건물접미사 표기차 흡수 (실제 6/17 사례)', () => {
  // "창포2차아이파크" → "창포아이파크" (메일 제목 "창포아이파크2차"와 부분일치)
  assert.ok(nameVariants('창포2차아이파크').includes('창포아이파크'));
  // "가곡시영맨션" → "가곡시영" (메일 제목 "가곡시영APT"와 부분일치)
  assert.ok(nameVariants('가곡시영맨션').includes('가곡시영'));
  assert.deepEqual(nameVariants(''), []);
});

test('matchEmails: 어순 다른 PM 공문도 변형 키워드로 PASS (창포 사례)', () => {
  const t = [{
    id: 'c1', threadId: 'cc1',
    subject: '[플러그링크] 창포아이파크2차 입주자대표회의 서비스개시 안내',
    from: 'chunggeun.kim@pluglink.kr',
    to: ['office-a@daum.net'], cc: ['"PM팀" <pm@pluglink.kr>'],
    date: '2026-06-10T17:03:53+09:00', snippet: '서비스개시 안내'
  }];
  const keywords = [...new Set(['창포2차아이파크'].flatMap(nameVariants))];
  const r = matchEmails(t, { keywords, pmEmails, myEmail: 'woojung.kim@pluglink.kr', groupEmails: ['pm@pluglink.kr'] });
  assert.equal(r.status, 'PASS');
});

test('matchEmails: 맨션 vs APT 표기차도 변형 키워드로 PASS (가곡 사례)', () => {
  const t = [{
    id: 'g1', threadId: 'gg1',
    subject: '[플러그링크] 가곡시영APT 서비스개시 안내',
    from: 'chunggeun.kim@pluglink.kr',
    to: ['office-b@daum.net'], cc: ['"PM팀" <pm@pluglink.kr>'],
    date: '2026-06-17T10:43:23+09:00', snippet: '서비스개시 안내'
  }];
  const keywords = [...new Set(['가곡시영맨션'].flatMap(nameVariants))];
  const r = matchEmails(t, { keywords, pmEmails, myEmail: 'woojung.kim@pluglink.kr', groupEmails: ['pm@pluglink.kr'] });
  assert.equal(r.status, 'PASS');
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
