import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;

export function pruneDataDir(dir, opts = {}) {
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const deleted = [];

  for (const name of readdirSync(dir)) {
    const m = name.match(DATE_PREFIX);
    if (!m) continue;
    if (m[1] < cutoffStr) {
      rmSync(path.join(dir, name));
      deleted.push(name);
    }
  }
  return deleted;
}
