/**
 * 충전소 페이지를 headless로 열어 HTML + 스크린샷 캡처.
 *
 * 실행:
 *   node scripts/inspect_station_page.js 10020322
 *
 * 출력:
 *   scripts/inspect_output/station_<id>.html
 *   scripts/inspect_output/station_<id>.png
 *
 * 사후: 그 파일을 Claude가 분석해 셀렉터 확정.
 */
import { openSession, closeSession } from '../lib/playwright_session.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const stationId = process.argv[2];
if (!stationId) {
  console.error('사용법: node scripts/inspect_station_page.js <stationId>');
  process.exit(1);
}

const OUT = path.resolve('scripts/inspect_output');
mkdirSync(OUT, { recursive: true });

const ctx = await openSession({ profileDir: './chrome_profile', headless: true });
const page = await ctx.newPage();
console.log('navigating...');
await page.goto(`https://connect.pluglink.kr/operation/stations/${stationId}/home`, {
  waitUntil: 'networkidle',
  timeout: 30000
});
console.log('current url:', page.url());

await page.waitForTimeout(2000); // SPA 추가 렌더 대기

const html = await page.content();
const htmlPath = path.join(OUT, `station_${stationId}.html`);
writeFileSync(htmlPath, html, 'utf8');
console.log('saved html:', htmlPath, '(', html.length, 'bytes)');

const pngPath = path.join(OUT, `station_${stationId}.png`);
await page.screenshot({ path: pngPath, fullPage: true });
console.log('saved screenshot:', pngPath);

await closeSession();
console.log('done.');
