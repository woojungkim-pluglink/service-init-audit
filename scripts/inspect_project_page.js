/**
 * 프로젝트 construction 페이지에서 stationId 추출 로직 분석.
 *
 * 실행:
 *   node scripts/inspect_project_page.js 25837
 *
 * 출력:
 *   - 페이지 URL + stationId 후보(있으면)
 *   - HTML + 스크린샷 저장
 */
import { openSession, closeSession } from '../lib/playwright_session.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectId = process.argv[2];
if (!projectId) {
  console.error('사용법: node scripts/inspect_project_page.js <projectId>');
  process.exit(1);
}

const OUT = path.resolve('scripts/inspect_output');
mkdirSync(OUT, { recursive: true });

const ctx = await openSession({ profileDir: './chrome_profile', headless: true });
const page = await ctx.newPage();

// 시트 A열 URL 형식과 동일하게 /construction
const url = `https://connect.pluglink.kr/manage/projects/${projectId}/construction`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('현재 URL:', page.url());

// stationId 후보: /operation/stations/{id} 형식 링크
const stationIds = await page.$$eval(
  'a',
  els => [...new Set(
    els.map(e => e.href)
      .map(h => (h.match(/\/operation\/stations\/(\d+)/) || [])[1])
      .filter(Boolean)
  )]
);
console.log('발견된 stationId 후보:', JSON.stringify(stationIds));

// 페이지 텍스트 일부 (계약 정보, 충전소 정보 위치 파악용)
const text = await page.evaluate(() => document.body.innerText);
console.log('=== 텍스트 (앞 2000자) ===');
console.log(text.slice(0, 2000));

writeFileSync(path.join(OUT, `project_${projectId}_construction.html`), await page.content(), 'utf8');
await page.screenshot({ path: path.join(OUT, `project_${projectId}_construction.png`), fullPage: true });
console.log('저장: scripts/inspect_output/project_' + projectId + '_construction.{html,png}');

await closeSession();
console.log('done.');
