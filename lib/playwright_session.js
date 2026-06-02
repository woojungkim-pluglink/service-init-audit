import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let _ctxPromise = null;

/**
 * Persistent context 재사용. 동시 호출 안전 (promise-memoize).
 * @param {{ profileDir: string, headless?: boolean }} opts
 */
export function openSession({ profileDir, headless = true }) {
  if (!_ctxPromise) {
    _ctxPromise = _launch({ profileDir, headless })
      .catch(err => { _ctxPromise = null; throw err; });
  }
  return _ctxPromise;
}

async function _launch({ profileDir, headless }) {
  const abs = path.resolve(profileDir);
  if (!existsSync(abs)) {
    // 새 환경(GitHub Actions/컨테이너 등): 빈 프로필 생성 → ensureSession이 ID/PW로 자동 로그인.
    // (로컬은 이미 로그인된 프로필이 존재하므로 이 경로 안 탐)
    mkdirSync(abs, { recursive: true });
  }
  return chromium.launchPersistentContext(abs, {
    headless,
    viewport: { width: 1440, height: 900 }
  });
}

export async function closeSession() {
  if (!_ctxPromise) return;
  const p = _ctxPromise;
  _ctxPromise = null;          // 먼저 null — close 실패해도 재진입 방지
  const ctx = await p.catch(() => null);
  if (ctx) await ctx.close();
}

/**
 * 로그인 만료 감지 — 정적 URL 확인. SPA redirect 진행 중에는 false negative 가능.
 */
export function assertLoggedIn(page) {
  if (/\/login(\?|$)/.test(page.url())) {
    throw new Error('PLINKCONNECT_LOGIN_EXPIRED');
  }
}
