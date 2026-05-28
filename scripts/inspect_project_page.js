/**
 * 프로젝트 페이지(계약탭 포함)를 캡처해 요금제 Phase 2 셀렉터 분석.
 *
 * 실행:
 *   node scripts/inspect_project_page.js 26404
 *
 * 출력:
 *   scripts/inspect_output/project_<id>.html
 *   scripts/inspect_output/project_<id>.png
 *   + 탭/버튼 텍스트 목록 콘솔 출력
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
await page.goto(`https://connect.pluglink.kr/manage/projects/${projectId}`, {
  waitUntil: 'domcontentloaded', timeout: 30000
});
await page.waitForTimeout(3000);
console.log('현재 URL:', page.url());

// 탭/버튼 텍스트 후보 (계약탭 찾기용)
const tabs = await page.$$eval('[role="tab"], button, a, [class*="tab"]',
  els => [...new Set(els.map(e => (e.textContent || '').trim()).filter(t => t && t.length <= 20))]
).catch(() => []);
console.log('탭/버튼 후보:', JSON.stringify(tabs.slice(0, 50), null, 0));

writeFileSync(path.join(OUT, `project_${projectId}.html`), await page.content(), 'utf8');
await page.screenshot({ path: path.join(OUT, `project_${projectId}.png`), fullPage: true });
console.log('저장:', `scripts/inspect_output/project_${projectId}.{html,png}`);

await closeSession();
console.log('done.');
