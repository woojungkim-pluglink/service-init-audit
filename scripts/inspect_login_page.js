/**
 * connect.pluglink.kr/login 페이지의 로그인 폼 구조 확인.
 * 임시 빈 프로파일을 써서 로그인 안 된 상태로 /login 페이지를 캡처한다.
 *
 * 실행:
 *   node scripts/inspect_login_page.js
 */
import { chromium } from 'playwright';
import { rmSync } from 'node:fs';

const TMP = './tmp_login_inspect';
const ctx = await chromium.launchPersistentContext(TMP, { headless: true });
const page = await ctx.newPage();
await page.goto('https://connect.pluglink.kr/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);

console.log('현재 URL:', page.url());

const inputs = await page.$$eval('input', els =>
  els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, autocomplete: e.autocomplete }))
);
const buttons = await page.$$eval('button', els =>
  els.map(e => ({ text: (e.textContent || '').trim().slice(0, 30), type: e.type }))
);

console.log('=== INPUT 필드 ===');
console.log(JSON.stringify(inputs, null, 2));
console.log('=== BUTTON ===');
console.log(JSON.stringify(buttons, null, 2));

await ctx.close();
// 임시 프로파일 정리
try { rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log('done');
