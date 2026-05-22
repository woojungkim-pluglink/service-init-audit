import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneDataDir } from '../lib/retention.js';

test('pruneDataDir: 90일 초과 파일 삭제', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'retention-'));
  writeFileSync(path.join(dir, '2025-01-01-morning.json'), '{}');
  writeFileSync(path.join(dir, '2026-05-22-morning.json'), '{}');
  writeFileSync(path.join(dir, 'index.json'), '{}');

  pruneDataDir(dir, { retentionDays: 90, today: '2026-05-22' });
  const left = readdirSync(dir).sort();
  assert.deepEqual(left, ['2026-05-22-morning.json', 'index.json']);
  rmSync(dir, { recursive: true });
});

test('pruneDataDir: dir 존재 안 하면 빈 배열 반환', () => {
  const result = pruneDataDir('/nonexistent/path/that/doesnt/exist', { today: '2026-05-22' });
  assert.deepEqual(result, []);
});
