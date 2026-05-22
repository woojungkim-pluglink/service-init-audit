import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlackMessages } from '../lib/discover.js';
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
