import { WebClient } from '@slack/web-api';

export function buildSummaryText({ written, waiting, noImage, errors, dryRun }) {
  const tag = dryRun ? '[드라이런] ' : '';
  const lines = [`${tag}🔌 충전테스트 보완완료 자동기입 결과`];
  lines.push(`• J열 기입: *${written.length}건*  • 대기(미완료): ${waiting.length}건  • 이미지 미첨부: ${noImage.length}건  • 오류: ${errors.length}건`);
  if (written.length) {
    lines.push('\n*기입 상세*');
    for (const w of written) lines.push(`  ✅ ${w.station} (T-${w.ticketId}) → ${w.date}`);
  }
  if (noImage.length) {
    lines.push('\n*완료지만 이미지 미첨부(확인 필요)*');
    for (const n of noImage) lines.push(`  ⚠️ ${n.station} (T-${n.ticketId})`);
  }
  if (errors.length) {
    lines.push('\n*오류*');
    for (const e of errors) lines.push(`  🔴 ${e.station || '-'} (T-${e.ticketId}) ${e.reason || ''}`);
  }
  return lines.join('\n');
}

export async function sendSummary(summary) {
  const token = process.env.SLACK_BOT_TOKEN;
  const text = buildSummaryText(summary);
  if (!token || !process.env.NOTIFY_SLACK_USER_ID) {
    console.log('[notify] Slack 미설정 — 콘솔 출력만:\n' + text);
    return;
  }
  const client = new WebClient(token);
  await client.chat.postMessage({ channel: process.env.NOTIFY_SLACK_USER_ID, text });
  if (process.env.NOTIFY_SLACK_CHANNEL_ID) {
    await client.chat.postMessage({ channel: process.env.NOTIFY_SLACK_CHANNEL_ID, text });
  }
}
