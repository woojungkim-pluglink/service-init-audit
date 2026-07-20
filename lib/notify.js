import { WebClient } from '@slack/web-api';

const LABEL = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트', initdate: '개시일자', comm: '통신' };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const OVERALL_EMOJI = { PASS: '✅', WARN: '⚠️', FAIL: '🔴', SKIP: '⏭️' };

/** 'YYYY-MM-DD' → 'YYYY-MM-DD(요일)' */
function withWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${date}(${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 다음 개시 예정 충전소 1줄 (통신 상태 포함) */
function tomorrowLine(s) {
  const name = s.stationName ?? s.projectName ?? s.address ?? `proj:${s.projectId}`;
  const st = s.checks?.status;
  const statusTag = st ? ` — 통신 ${st.status}${st.status !== 'PASS' && st.message ? ` (${st.message})` : ''}` : '';
  return `   · ${name}${statusTag}`;
}

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

  const byCheckLine = ['doc', 'rate', 'status', 'sheet', 'initdate', 'comm']
    .map(k => `${LABEL[k]} ${summary.byCheck?.[k]?.PASS ?? 0}/${totalStations}`)
    .join(' · ');

  const lines = [
    `[${date} ${slot}] 검증 완료`,
    `총 ${totalStations}건 · PASS ${byOverall.PASS ?? 0} · WARN ${byOverall.WARN ?? 0} · FAIL ${byOverall.FAIL ?? 0}`,
    byCheckLine,
    '',
    fails ? `FAIL 건:\n${fails}` : 'FAIL 건 없음'
  ];

  // 자동 원격제어(미운영→운영) 결과 — 조치한 충전소가 있을 때만
  const remStations = (stations || []).filter(s => s.remediation?.targets > 0);
  if (remStations.length > 0) {
    const allResults = remStations.flatMap(s =>
      s.remediation.results.map(r => ({ ...r, stationName: s.stationName ?? s.stationId }))
    );
    const dry = allResults.some(r => r.dryRun);
    const okN = allResults.filter(r => r.ok).length;
    const remLines = allResults.map(r => {
      const tag = r.dryRun ? '예정' : (r.ok ? '운영 전환✅' : `미반영(${r.after ?? r.error ?? '?'})`);
      return `   · ${r.stationName} 충전기 ${r.chargerId} → ${tag}`;
    });
    lines.push(
      '',
      `─── 자동 원격제어(미운영→운영) ${allResults.length}건${dry ? ' [DRY RUN]' : ` · 성공 ${okN}`} ───`,
      ...remLines
    );
  }

  // 충전기 대수 현황: 기축(기존) + 개시(오늘) = 총 — 충전소별.
  const withCounts = (stations || []).filter(s => s.chargerCounts);
  if (withCounts.length) {
    lines.push('', '─── 충전기 현황 (기축 + 개시 = 총) ───');
    for (const s of withCounts) {
      const cc = s.chargerCounts;
      lines.push(`   · ${s.stationName ?? s.stationId}: 기축 ${cc.existing} + 개시 ${cc.opened} = 총 ${cc.total}대`);
    }
  }

  // evening 슬롯: 다음 개시 예정 — 영차영차new BR 기재 확인 목록만 (운영 체크 없음).
  //   주말은 자동 실행이 없어 금요일 실행이 토·일·월을 함께 커버 → 날짜별로 묶어 표시.
  if (slot === 'evening' && tomorrowSummary) {
    const dates = tomorrowSummary.dates?.length
      ? tomorrowSummary.dates
      : [...new Set((tomorrowStations || []).map(s => s.initiatedAt))].sort();
    const total = tomorrowStations?.length ?? 0;
    const rangeLabel = dates.length
      ? (dates.length === 1 ? `내일(${withWeekday(dates[0])})` : `다음(${withWeekday(dates[0])}~${withWeekday(dates[dates.length - 1])})`)
      : '다음';
    const tb = tomorrowSummary.byOverall;
    const statusLine = tb ? ` · 통신 PASS ${tb.PASS ?? 0}·WARN ${tb.WARN ?? 0}·FAIL ${tb.FAIL ?? 0}·SKIP ${tb.SKIP ?? 0}` : '';
    lines.push('', `─── ${rangeLabel} 개시 예정 ${total}건${statusLine} ───`);
    if (total === 0) {
      lines.push('개시 예정 없음');
    } else if (dates.length <= 1) {
      lines.push(...(tomorrowStations || []).map(tomorrowLine));
    } else {
      // 여러 날짜 → 날짜별 그룹
      for (const d of dates) {
        const group = (tomorrowStations || []).filter(s => s.initiatedAt === d);
        lines.push(`[${withWeekday(d)}] ${group.length}건`);
        lines.push(...(group.length ? group.map(tomorrowLine) : ['   · (없음)']));
      }
    }
  }

  lines.push('', `대시보드: ${dashboardUrl}/?date=${date}&slot=${slot}`);
  return lines.join('\n');
}

/** 다음 개시 예정 1줄 (Block Kit mrkdwn, 통신 상태 이모지) */
function tomorrowBlockLine(s) {
  const name = s.stationName ?? s.projectName ?? s.address ?? `proj:${s.projectId}`;
  const st = s.checks?.status;
  const e = st ? (OVERALL_EMOJI[st.status] || '') : '';
  const note = st && st.status !== 'PASS' && st.message ? ` _(${st.message})_` : '';
  return `• ${name} ${e}${note}`.trimEnd();
}

/**
 * Slack Block Kit 블록 생성 — 가시성 높은 요약(헤더·필드·구분선·상태 이모지·대시보드 버튼).
 * 텍스트 fallback은 buildSummaryText.
 */
export function buildSummaryBlocks({ date, slot, summary, stations, dashboardUrl, tomorrowStations, tomorrowSummary }) {
  const slotKo = slot === 'morning' ? '오전' : '저녁';
  const { totalStations, byOverall, byCheck } = summary;
  const o = byOverall || {};
  const blocks = [];

  blocks.push({ type: 'header', text: { type: 'plain_text', text: `🔌 서비스개시 검증 — ${withWeekday(date)} ${slotKo}`, emoji: true } });

  const overall = `*총 ${totalStations}건*   ✅ ${o.PASS ?? 0}  ⚠️ ${o.WARN ?? 0}  🔴 ${o.FAIL ?? 0}${o.SKIP ? `  ⏭️ ${o.SKIP}` : ''}`;
  const section = { type: 'section', text: { type: 'mrkdwn', text: overall } };
  if (totalStations > 0) {
    section.fields = ['doc', 'rate', 'status', 'sheet', 'initdate', 'comm'].map(k => ({ type: 'mrkdwn', text: `*${LABEL[k]}*  ${byCheck?.[k]?.PASS ?? 0}/${totalStations}` }));
  }
  blocks.push(section);

  const fails = (stations || []).filter(s => s.overall === 'FAIL');
  const warns = (stations || []).filter(s => s.overall === 'WARN');
  const reasons = (s, st) => Object.entries(s.checks || {}).filter(([, c]) => c.status === st).map(([n]) => LABEL[n]).join(', ');
  if (fails.length) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🔴 *실패 ${fails.length}건*\n${fails.map(s => `• *${s.stationName ?? s.stationId}* — ${reasons(s, 'FAIL')}`).join('\n')}` } });
  }
  if (warns.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `⚠️ *주의 ${warns.length}건*\n${warns.map(s => `• ${s.stationName ?? s.stationId} — ${reasons(s, 'WARN')}`).join('\n')}` } });
  }
  if (totalStations > 0 && !fails.length && !warns.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '✅ *전건 정상*' } });
  }

  const remStations = (stations || []).filter(s => s.remediation?.targets > 0);
  if (remStations.length) {
    const results = remStations.flatMap(s => s.remediation.results.map(r => ({ ...r, stationName: s.stationName ?? s.stationId })));
    const dry = results.some(r => r.dryRun);
    const okN = results.filter(r => r.ok).length;
    const lines = results.map(r => `• ${r.stationName} 충전기 ${r.chargerId} → ${r.dryRun ? '예정' : (r.ok ? '운영 전환 ✅' : `미반영 (${r.after ?? r.error ?? '?'})`)}`).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🔧 *자동 원격제어 ${results.length}건*${dry ? ' _(DRY RUN)_' : ` · 성공 ${okN}`}\n${lines}` } });
  }

  // 충전기 대수 현황: 기축(기존) + 개시(오늘) = 총 — 충전소별.
  const withCounts = (stations || []).filter(s => s.chargerCounts);
  if (withCounts.length) {
    const cntLines = withCounts.map(s => {
      const cc = s.chargerCounts;
      return `• ${s.stationName ?? s.stationId}: 기축 ${cc.existing} + 개시 ${cc.opened} = *총 ${cc.total}대*`;
    }).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🔌 *충전기 현황 (기축 + 개시 = 총)*\n${cntLines}` } });
  }

  if (slot === 'evening' && tomorrowSummary) {
    const dates = tomorrowSummary.dates?.length ? tomorrowSummary.dates : [...new Set((tomorrowStations || []).map(s => s.initiatedAt))].sort();
    const total = tomorrowStations?.length ?? 0;
    const rangeLabel = dates.length ? (dates.length === 1 ? `내일(${withWeekday(dates[0])})` : `다음(${withWeekday(dates[0])}~${withWeekday(dates[dates.length - 1])})`) : '다음';
    const tb = tomorrowSummary.byOverall || {};
    let txt = `🌅 *${rangeLabel} 개시 예정 ${total}건*   통신 ✅ ${tb.PASS ?? 0}  ⚠️ ${tb.WARN ?? 0}  🔴 ${tb.FAIL ?? 0}${tb.SKIP ? `  ⏭️ ${tb.SKIP}` : ''}`;
    if (total === 0) txt += '\n_개시 예정 없음_';
    else if (dates.length <= 1) txt += '\n' + (tomorrowStations || []).map(tomorrowBlockLine).join('\n');
    else for (const d of dates) {
      const g = (tomorrowStations || []).filter(s => s.initiatedAt === d);
      txt += `\n*[${withWeekday(d)}] ${g.length}건*\n` + (g.length ? g.map(tomorrowBlockLine).join('\n') : '   · (없음)');
    }
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: txt } });
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${dashboardUrl}/?date=${date}&slot=${slot}|📊 대시보드 열기>  ·  서비스개시 자동검증` }] });
  return blocks;
}

export async function sendDM({ token, userId, text, blocks, dryRun, threadTs }) {
  if (dryRun) {
    const tag = threadTs ? `DRY RUN CHANNEL (thread_ts=${threadTs})` : 'DRY RUN DM';
    console.log(`--- ${tag} ---\n${text}\n------------------`);
    return { ok: true, dryRun: true };
  }
  const client = new WebClient(token);
  const payload = { channel: userId, text };           // text = 알림 미리보기 fallback
  if (blocks && blocks.length) payload.blocks = blocks; // 본문은 Block Kit
  if (threadTs) payload.thread_ts = threadTs;
  return client.chat.postMessage(payload);
}
