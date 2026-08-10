/**
 * 개시 후 30일 정착 추적(settle) 실행 1회분 — 대시보드 전용(Slack 발송 없음).
 *
 * 절대 밖으로 throw하지 않는다: 실패 시 '직전 성공 내용 + error 필드'로 settle.json을 남겨
 * 대시보드가 "갱신 실패" 배너 + 직전 데이터를 보여주게 한다 (조용한 실패 금지).
 * 직전 성공분은 라이브 대시보드의 settle.json에서 seed한다 (CI는 stateless —
 * audit.js가 live index.json으로 dedup하는 기존 패턴과 동일).
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { extractConnectToken, fetchAccumulations, fetchStatusDevices, fetchLiveSettle } from './settle_api.js';
import { buildSnapshot, diffSnapshots, STATUS_TYPES } from './settle_core.js';

export async function runSettle({ browserContext, base, dashboardUrl, dataDir, date, slot, windowDays = 30, refEpochMs = Date.now() }) {
  const outFile = path.join(dataDir, 'settle.json');
  const prev = await fetchLiveSettle(dashboardUrl);
  // 실패 파일은 '직전 성공 내용 + error'이므로 error만 벗기면 직전 성공분이 복원된다
  let prevGood = null;
  if (prev) {
    const { error: _e, ...rest } = prev;
    if (rest.runAt) prevGood = rest;
  }
  try {
    const token = await extractConnectToken(browserContext, base);
    const accumulations = await fetchAccumulations(token);
    const byType = {};
    let truncated = false;
    for (const t of STATUS_TYPES) {
      const r = await fetchStatusDevices(token, t);
      byType[t] = r.items;
      truncated = truncated || r.truncated;
      if (r.truncated) console.warn(`[settle] ${t} 페이지 상한 도달 — 일부만 수집됨`);
    }
    const snapshot = buildSnapshot({
      byType, accumulations, date, slot,
      runAt: new Date(refEpochMs).toISOString(), refEpochMs, windowDays, truncated
    });
    if (prevGood) {
      snapshot.diff = diffSnapshots(prevGood, snapshot);
      snapshot.prevRunAt = prevGood.runAt ?? null;
    }
    writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    return { ok: true, tracked: snapshot.items.length, diff: snapshot.diff };
  } catch (e) {
    // 공개 대시보드에 게시되는 메시지 — audit.js sanitizeError와 동일 규칙 (첫 줄만·URL 마스킹·길이 제한)
    const message = String(e?.message ?? e)
      .split('\n')[0]
      .replace(/https?:\/\/[^\s)"']+/g, '[url]')
      .slice(0, 200);
    const failed = {
      ...(prevGood ?? { items: [], runAt: null }),
      diff: null, // 실패 시점의 diff는 무의미 — stale 신규/복구 표시 방지
      error: { message, failedAt: new Date(refEpochMs).toISOString(), lastSuccessAt: prevGood?.runAt ?? null }
    };
    try { writeFileSync(outFile, JSON.stringify(failed, null, 2)); } catch { /* 쓰기 실패 시 라이브 유지 */ }
    console.error('[settle] 실패 —', message);
    return { ok: false, error: message };
  }
}
