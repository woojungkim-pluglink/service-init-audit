import { WebClient } from '@slack/web-api';

const DEFAULT_CHANNEL = 'C026XGZE1GT';
const STATION_RE = /connect\.pluglink\.kr\/stations\/([A-Za-z0-9-]+)/;
const PROJECT_RE = /connect\.pluglink\.kr\/projects\/([A-Za-z0-9-]+)/;

export function parseSlackMessages(messages, channelId = DEFAULT_CHANNEL) {
  const out = [];
  for (const m of messages) {
    if (m.subtype) continue;
    if (!m.text) continue;
    const sm = m.text.match(STATION_RE);
    const pm = m.text.match(PROJECT_RE);
    if (!sm || !pm) continue;
    const tsForPermalink = m.ts.replace(/\./g, '');
    out.push({
      ts: m.ts,
      permalink: `https://pluglink.slack.com/archives/${channelId}/p${tsForPermalink}`,
      stationId: sm[1],
      projectId: pm[1],
      rawText: m.text
    });
  }
  return out;
}

/**
 * 슬롯의 시각 범위에 해당하는 메시지를 가져와서 파싱.
 * @param {object} opts { slot: 'morning'|'evening', date: 'YYYY-MM-DD', token, channelId }
 */
export async function discoverProjects({ slot, date, token, channelId = DEFAULT_CHANNEL }) {
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
