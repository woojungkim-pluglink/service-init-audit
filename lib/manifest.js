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

  // settle 색인은 CI seed 가 일별 스냅샷을 받아오는 목록이다 — 여기서 떨어뜨리면
  // 다음 배포에 스냅샷 파일이 포함되지 않아 이력이 통째로 사라진다. 보존기간만 적용해 넘긴다.
  const settle = (manifest.settle || []).filter(s => s.date >= cutoffStr);

  const lastUpdated = opts.now ?? new Date().toISOString();
  return { lastUpdated, slots, settle };
}

/**
 * 정착 추적 일별 스냅샷 색인 갱신. 날짜당 1건 — 같은 날 재실행(저녁)은 덮어써 그날의 최종 상태를 남긴다.
 * @param {{slots?: Array, settle?: Array<{date:string, file:string}>}} manifest
 * @param {{date:string, file:string, tracked?:number, runAt?:string}} entry
 */
export function upsertSettleIndex(manifest, entry) {
  const settle = (manifest?.settle || []).filter(s => s.date !== entry.date);
  settle.push(entry);
  settle.sort((a, b) => a.date.localeCompare(b.date));
  return { ...manifest, settle };
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
