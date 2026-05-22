/**
 * 초기 1회 로그인 헬퍼.
 *
 * 실행:
 *   node scripts/login_once.js
 *
 * 동작:
 *   1. ./chrome_profile/ 디렉토리에 영구 컨텍스트로 Chromium을 띄움 (headless=false)
 *   2. 사용자가 직접 https://connect.pluglink.kr 로그인
 *   3. 같은 컨텍스트에서 https://docs.google.com 로그인 (Google Sheets gviz용)
 *   4. 두 사이트 로그인 확인 후 사용자가 창을 닫으면 종료
 *
 * 이후 audit.js는 같은 chrome_profile/ 을 헤드리스로 재사용한다.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const PROFILE_DIR = path.resolve('./chrome_profile');
if (!existsSync(PROFILE_DIR)) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log('chrome_profile/ 생성');
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 }
});

const page = await ctx.newPage();
await page.goto('https://connect.pluglink.kr/login');

console.log('────────────────────────────────────────────');
console.log(' 1) connect.pluglink.kr 에 로그인하세요');
console.log(' 2) 같은 창 새 탭에서 https://docs.google.com 에도 로그인');
console.log(' 3) 두 사이트가 모두 로그인된 상태로 창을 닫으면 종료됩니다');
console.log('────────────────────────────────────────────');

// 사용자가 창을 닫을 때까지 대기 (모든 페이지가 닫히면 컨텍스트도 닫힘)
await new Promise(resolve => ctx.once('close', resolve));
console.log('로그인 세션 저장 완료 (chrome_profile/)');
