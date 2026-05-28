/**
 * 충전소 페이지의 body.innerText 를 그대로 덤프 (정규식이 실행되는 실제 입력).
 * 실행: node scripts/dump_station_text.js 10032999
 * 출력: scripts/inspect_output/station_<id>.txt
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

const stationId = process.argv[2];
if (!stationId) {
  console.error('사용법: node scripts/dump_station_text.js <stationId>');
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
await page.goto(`https://connect.pluglink.kr/operation/stations/${stationId}/home`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});
console.log('url:', page.url());
assertLoggedIn(page);
await page.waitForTimeout(2000);
console.log('url after wait:', page.url());
try {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('table thead th'))
      .some(th => /충전기\s*ID/.test(th.textContent || '')),
    { timeout: 15000 }
  );
  console.log('table header found');
} catch (e) {
  console.log('table header NOT found within 15s');
}

const text = await page.evaluate(() => document.body.innerText);
const outPath = path.join(OUT, `station_${stationId}.txt`);
writeFileSync(outPath, text, 'utf8');
console.log('saved:', outPath, '(', text.length, 'chars)');

await closeSession();
console.log('done.');
