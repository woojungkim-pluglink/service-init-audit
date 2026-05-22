export function upsertManifest(manifest, entry, opts = {}) {
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const slots = (manifest.slots || [])
    .filter(s => s.date >= cutoffStr)
    .filter(s => !(s.date === entry.date && s.slot === entry.slot));
  slots.push(entry);
  slots.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

  return { lastUpdated: new Date().toISOString(), slots };
}
