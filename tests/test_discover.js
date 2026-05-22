import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlackMessages, extractMetadata } from '../lib/discover.js';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/slack_messages.json', import.meta.url)));

test('parseSlackMessages: 마크다운 링크 형식에서 stationId/projectId 추출', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result.length, 2);
  assert.equal(result[0].stationId, '12345');
  assert.equal(result[0].projectId, 'abc-uuid');
  assert.equal(result[0].ts, '1779404445.913559');
  assert.match(result[0].permalink, /p1779404445913559$/);
});

test('parseSlackMessages: 평문 URL 형식에서도 추출', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result[1].stationId, '67890');
  assert.equal(result[1].projectId, 'def-uuid');
});

test('parseSlackMessages: subtype 있는 메시지(채널 입장 등) 제외', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result.find(r => r.ts === '1779404600.000000'), undefined);
});

test('parseSlackMessages: 충전소 링크 없는 메시지는 제외', () => {
  const noLink = [{ ts: '1.0', type: 'message', text: '점심 어디서 먹지' }];
  assert.equal(parseSlackMessages(noLink).length, 0);
});

test('parseSlackMessages: stationName/projectName/chargerCount 추출 (마크다운)', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result[0].stationName, 'OO아파트');
  assert.equal(result[0].projectName, 'OO아파트 프로젝트');
  assert.equal(result[0].chargerCount, 4);
});

test('parseSlackMessages: 평문 URL 메시지에서도 stationName 폴백 (헤더 라인)', () => {
  const result = parseSlackMessages(fixture.messages);
  // 두 번째 메시지: 충전소 라인이 평문 URL이라 link label 없음 → 헤더 '[서비스개시] XX빌라' 사용
  assert.equal(result[1].stationName, 'XX빌라');
  // projectName도 link label 없으면 stationName 폴백
  assert.equal(result[1].projectName, 'XX빌라');
  assert.equal(result[1].chargerCount, 2);
});

test('extractMetadata: chargerCount 없으면 null', () => {
  const meta = extractMetadata('[서비스개시] ZZ아파트\n충전소: url\n프로젝트: url');
  assert.equal(meta.chargerCount, null);
});
