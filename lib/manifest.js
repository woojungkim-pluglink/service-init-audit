import { calcCutoff } from './date_utils.js';

export function upsertManifest(manifest, entry, opts = {}) {
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoffStr = calcCutoff(today, retentionDays);

  const slots = (manifest.slots || [])
    .filter(s => s.date >= cutoffStr)
    .filter(s => !(s.date === entry.date && s.slot === entry.slot));
  slots.push(entry);
  slots.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

  const lastUpdated = opts.now ?? new Date().toISOString();
  return { lastUpdated, slots };
}

/**
 * 해당 (date, slot)이 이미 매니페스트에 있는지 — 중복 실행 방지용.
 *   n8n 정시 트리거 + GitHub cron 백업이 둘 다 도는 경우, 먼저 끝난 실행이 매니페스트를
 *   갱신·배포하므로 이후 실행은 이 함수로 감지해 알림·배포를 건너뛴다.
 * @param {{slots?: Array<{date:string, slot:string}>}} manifest
 * @returns {boolean}
 */
export function slotAlreadyDone(manifest, date, slot) {
  return (manifest?.slots || []).some(s => s.date === date && s.slot === slot);
}
