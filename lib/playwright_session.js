import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';

let _ctx = null;

export async function openSession({ profileDir, headless = true }) {
  if (_ctx) return _ctx;
  const abs = path.resolve(profileDir);
  if (!existsSync(abs)) {
    throw new Error(`chrome_profile not found at ${abs}. Run pluglink-connect-login first.`);
  }
  _ctx = await chromium.launchPersistentContext(abs, {
    headless,
    viewport: { width: 1440, height: 900 }
  });
  return _ctx;
}

export async function closeSession() {
  if (_ctx) { await _ctx.close(); _ctx = null; }
}

/**
 * 로그인 만료 감지 — 어떤 페이지든 /login으로 redirect되면 throw
 */
export async function assertLoggedIn(page) {
  if (/\/login(\?|$)/.test(page.url())) {
    throw new Error('PLINKCONNECT_LOGIN_EXPIRED');
  }
}
