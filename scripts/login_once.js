/**
 * 초기 1회 로그인 헬퍼.
 *
 * 실행:
 *   node scripts/login_once.js
 *
 * 동작:
 *   1. ./chrome_profile/ 영구 컨텍스트로 Chromium을 띄움 (headless=false)
 *   2. 두 탭을 자동으로 엶: connect.pluglink.kr 로그인 + docs.google.com 로그인
 *   3. 사용자가 두 사이트 모두 로그인 후 Chrome 창을 닫으면 종료
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

// 탭 1: plinkconnect
const tab1 = await ctx.newPage();
await tab1.goto('https://connect.pluglink.kr/login');

// 탭 2: Google Docs (Sheets gviz 호출용 세션)
const tab2 = await ctx.newPage();
await tab2.goto('https://docs.google.com');

console.log('────────────────────────────────────────────');
console.log(' 1) 탭1: connect.pluglink.kr 에 로그인');
console.log(' 2) 탭2: docs.google.com (Google 계정) 에 로그인');
console.log(' 3) 두 탭 모두 로그인된 상태로 Chrome 창 X로 닫으면 종료');
console.log('────────────────────────────────────────────');

await new Promise(resolve => ctx.once('close', resolve));
console.log('로그인 세션 저장 완료 (chrome_profile/)');
