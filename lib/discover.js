import { WebClient } from '@slack/web-api';

const DEFAULT_CHANNEL = 'C026XGZE1GT';

// 1개 메시지 안에 여러 충전소 라인이 있음. 라인 패턴 예:
//   *<https://connect.pluglink.kr/operation/stations/10020322/home|세원한아름아파트(10020322)>* - 총 6기 (운영: 5기, 미운영: 1기)
const STATION_LINE_RE =
  /<https?:\/\/connect\.pluglink\.kr\/operation\/stations\/(\d+)\/home\|([^>]+)>\*?\s*-\s*총\s*(\d+)기\s*\(운영:\s*(\d+)기[^,]*,\s*미운영:\s*(\d+)기\)/g;

// 헤더 라인 예: "*2026-05-22 서비스 개시 (00:00 ~ 08:00)*"
const HEADER_DATE_RE = /\*?(\d{4}-\d{2}-\d{2})\s*서비스\s*개시\s*\(([^)]+)\)\*?/;

/**
 * 메시지에서 충전소명 끝의 "(stationId)" 표기 제거.
 *   "세원한아름아파트(10020322)" → "세원한아름아파트"
 */
function cleanStationName(raw) {
  return raw.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * 슬랙 메시지 1건에서 여러 충전소를 추출.
 * @returns {Array<{ts, permalink, stationId, stationName, totalChargers, activeChargers, inactiveChargers, headerDate, headerWindow}>}
 */
export function parseSlackMessage(message, channelId = DEFAULT_CHANNEL) {
  if (message.subtype) return [];
  if (!message.text) return [];
  const out = [];
  const headerMatch = message.text.match(HEADER_DATE_RE);
  const headerDate = headerMatch?.[1] ?? null;
  const headerWindow = headerMatch?.[2]?.trim() ?? null;
  const tsForPermalink = message.ts.replace(/\./g, '');
  const permalink = `https://pluglink.slack.com/archives/${channelId}/p${tsForPermalink}`;

  let m;
  STATION_LINE_RE.lastIndex = 0;
  while ((m = STATION_LINE_RE.exec(message.text)) !== null) {
    out.push({
      ts: message.ts,
      permalink,
      stationId: m[1],
      stationName: cleanStationName(m[2]),
      totalChargers: parseInt(m[3], 10),
      activeChargers: parseInt(m[4], 10),
      inactiveChargers: parseInt(m[5], 10),
      headerDate,
      headerWindow
    });
  }
  return out;
}

/**
 * 여러 메시지에서 충전소 목록 추출.
 */
export function parseSlackMessages(messages, channelId = DEFAULT_CHANNEL) {
  const out = [];
  for (const m of messages) {
    out.push(...parseSlackMessage(m, channelId));
  }
  return out;
}

/**
 * 슬롯 시각 범위 메시지 fetch + 충전소 추출.
 * 슬롯 정의 (KST):
 *   morning: 07:30 ~ 09:00  (08:00 알림 포함)
 *   evening: 16:30 ~ 18:00  (17:00 알림 포함)
 */
export async function discoverStations({ slot, date, token, channelId = DEFAULT_CHANNEL }) {
  if (slot !== 'morning' && slot !== 'evening') {
    throw new Error(`Unknown slot: ${slot}`);
  }
  const client = new WebClient(token);
  const window = slot === 'morning'
    ? { start: '07:30', end: '09:00' }
    : { start: '16:30', end: '18:00' };
  const oldest = new Date(`${date}T${window.start}:00+09:00`).getTime() / 1000;
  const latest = new Date(`${date}T${window.end}:00+09:00`).getTime() / 1000;

  const resp = await client.conversations.history({
    channel: channelId,
    oldest: String(oldest),
    latest: String(latest),
    inclusive: true,
    limit: 200
  });
  if (!resp.ok) throw new Error(`slack history failed: ${resp.error}`);
  return parseSlackMessages(resp.messages || [], channelId);
}
