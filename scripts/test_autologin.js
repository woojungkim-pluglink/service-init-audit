/**
 * 자동 로그인 검증.
 * 임시 빈 프로파일로 시작 → 무조건 /login → ensureSession이 자동 로그인 수행하는지 확인.
 *
 * 실행: node scripts/test_autologin.js
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
import { ensureSession } from '../lib/plinkconnect_auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'config', '.env') });

const BASE = process.env.PLINKCONNECT_BASE || 'https://connect.pluglink.kr';
const TMP = path.join(__dirname, '..', 'tmp_autologin_test');

const ctx = await chromium.launchPersistentContext(TMP, { headless: true });
try {
  const did = await ensureSession(ctx, {
    base: BASE,
    username: process.env.PLINKCONNECT_USERNAME,
    password: process.env.PLINKCONNECT_PASSWORD
  });
  console.log('ensureSession 결과:', did ? '✅ 자동 로그인 수행됨' : '⚠️ 이미 로그인 상태(빈 프로파일에선 예상밖)');

  // 로그인 후 충전소 페이지 실제 접근 검증
  const page = await ctx.newPage();
  await page.goto(`${BASE}/operation/stations/10027905/home`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const url = page.url();
  console.log('충전소 페이지 URL:', url);
  console.log(/\/login(\?|$)/.test(url) ? '❌ 여전히 로그인 안 됨 — 자동 로그인 실패' : '✅ 로그인 세션 유효 — 자동 로그인 성공');
} catch (e) {
  console.error('❌ 검증 실패:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await ctx.close();
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
