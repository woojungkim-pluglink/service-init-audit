import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSlackMessage, parseSlackMessages } from '../lib/discover.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/slack_morning_message.json', import.meta.url)));

test('parseSlackMessage: 1 메시지 → 여러 충전소 추출', () => {
  const stations = parseSlackMessage(fixture.messages[0]);
  assert.equal(stations.length, 3);
});

test('parseSlackMessage: stationId/stationName 정확', () => {
  const stations = parseSlackMessage(fixture.messages[0]);
  assert.equal(stations[0].stationId, '10020322');
  assert.equal(stations[0].stationName, '세원한아름아파트');
  assert.equal(stations[1].stationId, '10032049');
  assert.equal(stations[1].stationName, '경기 성남 중원구 두산위브아파트');
});

test('parseSlackMessage: 충전기 수 (운영/미운영) 정확', () => {
  const stations = parseSlackMessage(fixture.messages[0]);
  assert.equal(stations[0].totalChargers, 6);
  assert.equal(stations[0].activeChargers, 5);
  assert.equal(stations[0].inactiveChargers, 1);
  assert.equal(stations[1].totalChargers, 10);
  assert.equal(stations[1].activeChargers, 10);
  assert.equal(stations[1].inactiveChargers, 0);
});

test('parseSlackMessage: 헤더 날짜와 시간 윈도우 파싱', () => {
  const stations = parseSlackMessage(fixture.messages[0]);
  assert.equal(stations[0].headerDate, '2026-05-22');
  assert.equal(stations[0].headerWindow, '00:00 ~ 08:00');
});

test('parseSlackMessage: permalink 정확', () => {
  const stations = parseSlackMessage(fixture.messages[0]);
  assert.match(stations[0].permalink, /p1779404445913559$/);
  assert.equal(stations[0].ts, '1779404445.913559');
});

test('parseSlackMessage: subtype 메시지는 빈 배열', () => {
  const result = parseSlackMessage(fixture.messages[1]);
  assert.deepEqual(result, []);
});

test('parseSlackMessage: 충전소 라인 없는 메시지는 빈 배열', () => {
  const result = parseSlackMessage({ ts: '1.0', type: 'message', text: '점심 어디서 먹지' });
  assert.deepEqual(result, []);
});

test('parseSlackMessages: 여러 메시지 통합', () => {
  const all = parseSlackMessages(fixture.messages);
  assert.equal(all.length, 3); // subtype 메시지 제외
});
