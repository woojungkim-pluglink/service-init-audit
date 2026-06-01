/**
 * 프로젝트 계약탭의 body.innerText 덤프 (요금제 fallback 추출기 설계용).
 * 실행: node scripts/dump_contract_text.js 24446
 * 출력: scripts/inspect_output/contract_<id>.txt
 */
import { openSession, closeSession, assertLoggedIn } from '../lib/playwright_session.js';
import { ensureSession } from '../lib/plinkconnect_auth.js';
import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'config', '.env') });
const BASE = process.env.PLINKCONNECT_BASE || 'https://connect.pluglink.kr';

const projectId = process.argv[2];
if (!projectId) {
  console.error('사용법: node scripts/dump_contract_text.js <projectId>');
  process.exit(1);
}

const OUT = path.resolve('scripts/inspect_output');
mkdirSync(OUT, { recursive: true });

const ctx = await openSession({ profileDir: './chrome_profile', headless: true });
await ensureSession(ctx, {
  base: BASE,
  username: process.env.PLINKCONNECT_USERNAME,
  password: process.env.PLINKCONNECT_PASSWORD
});
const page = await ctx.newPage();
await page.goto(`${BASE}/manage/projects/${projectId}/contract`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});
console.log('url:', page.url());
assertLoggedIn(page);
await page.waitForTimeout(2000);
try {
  await page.waitForFunction(
    () => /특약요금제|계약\s*결과|일반요금제/.test(document.body.innerText || ''),
    { timeout: 15000 }
  );
  console.log('contract content found');
} catch (e) {
  console.log('contract content NOT found within 15s');
}

const text = await page.evaluate(() => document.body.innerText);
const outPath = path.join(OUT, `contract_${projectId}.txt`);
writeFileSync(outPath, text, 'utf8');
console.log('saved:', outPath, '(', text.length, 'chars)');

await closeSession();
console.log('done.');
