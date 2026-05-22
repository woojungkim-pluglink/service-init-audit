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
