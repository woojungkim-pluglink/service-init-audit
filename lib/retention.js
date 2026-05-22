import { readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { calcCutoff } from './date_utils.js';

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;

export function pruneDataDir(dir, opts = {}) {
  if (!existsSync(dir)) return [];
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoffStr = calcCutoff(today, retentionDays);
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
