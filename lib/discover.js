import { WebClient } from '@slack/web-api';

const DEFAULT_CHANNEL = 'C026XGZE1GT';
const STATION_RE = /connect\.pluglink\.kr\/stations\/([A-Za-z0-9-]+)/;
const PROJECT_RE = /connect\.pluglink\.kr\/projects\/([A-Za-z0-9-]+)/;
const STATION_LINK_LABEL_RE = /충전소:\s*<[^|>]+\|([^>]+)>/;
const PROJECT_LINK_LABEL_RE = /프로젝트:\s*<[^|>]+\|([^>]+)>/;
const FIRST_LINE_HEADER_RE = /^\[서비스개시\]\s*(.+)$/m;
const CHARGER_COUNT_RE = /충전기\s*(\d+)\s*대/;

/**
 * rawText에서 projectName/stationName/chargerCount 추출.
 * 패턴이 없으면 null. Task 14에서 실 메시지 형식 보고 정규식 보강.
 */
export function extractMetadata(rawText) {
  const stationLabel = rawText.match(STATION_LINK_LABEL_RE)?.[1]?.trim();
  const projectLabel = rawText.match(PROJECT_LINK_LABEL_RE)?.[1]?.trim();
  const headerLine = rawText.match(FIRST_LINE_HEADER_RE)?.[1]?.trim();
  const chargerCountStr = rawText.match(CHARGER_COUNT_RE)?.[1];

  const stationName = stationLabel ?? headerLine ?? null;
  const projectName = projectLabel ?? stationName;
  const chargerCount = chargerCountStr ? parseInt(chargerCountStr, 10) : null;

  return { stationName, projectName, chargerCount };
}

export function parseSlackMessages(messages, channelId = DEFAULT_CHANNEL) {
  const out = [];
  for (const m of messages) {
    if (m.subtype) continue;
    if (!m.text) continue;
    const sm = m.text.match(STATION_RE);
    const pm = m.text.match(PROJECT_RE);
    if (!sm || !pm) continue;
    const tsForPermalink = m.ts.replace(/\./g, '');
    const meta = extractMetadata(m.text);
    out.push({
      ts: m.ts,
      permalink: `https://pluglink.slack.com/archives/${channelId}/p${tsForPermalink}`,
      stationId: sm[1],
      projectId: pm[1],
      stationName: meta.stationName,
      projectName: meta.projectName,
      chargerCount: meta.chargerCount,
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
