import { WebClient } from '@slack/web-api';

const LABEL = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트' };

export function buildSummaryText({ date, slot, summary, projects, dashboardUrl }) {
  const { totalProjects, byOverall } = summary;

  const fails = projects
    .filter(p => p.overall === 'FAIL')
    .map(p => {
      const reasons = Object.entries(p.checks)
        .filter(([, c]) => c.status === 'FAIL')
        .map(([name]) => `${LABEL[name]} FAIL`);
      return `   · ${p.projectName} (${reasons.join(', ')})`;
    })
    .join('\n');

  // by-check 라인은 PASS 비율만 한 줄 요약. WARN/FAIL 상세는 대시보드에서 확인.
  const byCheckLine = ['doc', 'rate', 'status', 'sheet']
    .map(k => {
      const c = summary.byCheck[k];
      return `${LABEL[k]} ${c.PASS}/${totalProjects}`;
    })
    .join(' · ');

  return [
    `[${date} ${slot}] 검증 완료`,
    `총 ${totalProjects}건 · PASS ${byOverall.PASS ?? 0} · WARN ${byOverall.WARN ?? 0} · FAIL ${byOverall.FAIL ?? 0}`,
    byCheckLine,
    '',
    fails ? `FAIL 건:\n${fails}` : 'FAIL 건 없음',
    '',
    `대시보드: ${dashboardUrl}/?date=${date}&slot=${slot}`
  ].join('\n');
}

export async function sendDM({ token, userId, text, dryRun }) {
  if (dryRun) {
    console.log('--- DRY RUN DM ---\n' + text + '\n------------------');
    return { ok: true, dryRun: true };
  }
  const client = new WebClient(token);
  return client.chat.postMessage({ channel: userId, text });
}
