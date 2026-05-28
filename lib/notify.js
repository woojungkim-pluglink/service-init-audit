import { WebClient } from '@slack/web-api';

const LABEL = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트' };

export function buildSummaryText({ date, slot, summary, stations, dashboardUrl, tomorrowStations, tomorrowSummary }) {
  const { totalStations, byOverall } = summary;

  const fails = (stations || [])
    .filter(s => s.overall === 'FAIL')
    .map(s => {
      const reasons = Object.entries(s.checks || {})
        .filter(([, c]) => c.status === 'FAIL')
        .map(([name]) => `${LABEL[name]} FAIL`);
      return `   · ${s.stationName ?? s.stationId} (${reasons.join(', ')})`;
    })
    .join('\n');

  const byCheckLine = ['doc', 'rate', 'status', 'sheet']
    .map(k => {
      const c = summary.byCheck[k];
      return `${LABEL[k]} ${c.PASS}/${totalStations}`;
    })
    .join(' · ');

  const lines = [
    `[${date} ${slot}] 검증 완료`,
    `총 ${totalStations}건 · PASS ${byOverall.PASS ?? 0} · WARN ${byOverall.WARN ?? 0} · FAIL ${byOverall.FAIL ?? 0}`,
    byCheckLine,
    '',
    fails ? `FAIL 건:\n${fails}` : 'FAIL 건 없음'
  ];

  // evening 슬롯: 내일 개시 예정 섹션 승안
  if (tomorrowStations && tomorrowStations.length > 0 && tomorrowSummary) {
    const tomorrowDate = tomorrowStations[0].initiatedAt;
    const tBy = tomorrowSummary.byOverall;
    const tByCheck = ['doc', 'rate', 'status']
      .map(k => `${LABEL[k]} ${tomorrowSummary.byCheck[k]?.PASS ?? 0}/${tomorrowSummary.totalStations}`)
      .join(' · ');
    const tomorrowFails = tomorrowStations
      .filter(s => s.overall === 'FAIL' || s.overall === 'WARN')
      .map(s => {
        const reasons = Object.entries(s.checks || {})
          .filter(([, c]) => c.status === 'FAIL' || c.status === 'WARN')
          .map(([name, c]) => `${LABEL[name]} ${c.status}`);
        return `   · ${s.stationName ?? s.address ?? `proj:${s.projectId}`} (${reasons.join(', ')})`;
      })
      .join('\n');
    lines.push(
      '',
      `─── 내일(${tomorrowDate}) 개시 예정 ${tomorrowSummary.totalStations}건 ───`,
      `PASS ${tBy.PASS ?? 0} · WARN ${tBy.WARN ?? 0} · FAIL ${tBy.FAIL ?? 0} · SKIP ${tBy.SKIP ?? 0}`,
      tByCheck,
      tomorrowFails ? `미해결:\n${tomorrowFails}` : '미해결 없음'
    );
  } else if (slot === 'evening' && tomorrowSummary?.totalStations === 0) {
    lines.push('', '─── 내일 개시 예정 없음 ───');
  }

  lines.push('', `대시보드: ${dashboardUrl}/?date=${date}&slot=${slot}`);
  return lines.join('\n');
}

export async function sendDM({ token, userId, text, dryRun }) {
  if (dryRun) {
    console.log('--- DRY RUN DM ---\n' + text + '\n------------------');
    return { ok: true, dryRun: true };
  }
  const client = new WebClient(token);
  return client.chat.postMessage({ channel: userId, text });
}
