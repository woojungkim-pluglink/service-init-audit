/**
 * connect.pluglink.kr 자동 로그인.
 * 세션 만료 시 ID/PW 직접 입력 방식으로 재로그인하여 chrome_profile 세션을 갱신한다.
 *
 * 로그인 폼 (확인된 셀렉터):
 *   - #email     (type=text, "이메일 주소를 입력하세요")
 *   - #password  (type=password)
 *   - button "로그인"
 */

/**
 * 로그인 상태 보장. /login으로 가서 이미 로그인돼 있으면 통과,
 * 아니면 ID/PW로 로그인 수행.
 * @param {import('playwright').BrowserContext} browserContext
 * @param {{ base: string, username: string, password: string }} opts
 * @returns {Promise<boolean>} 로그인 수행했으면 true, 이미 로그인 상태면 false
 */
export async function ensureSession(browserContext, { base, username, password }) {
  if (!username || !password) {
    throw new Error('PLINKCONNECT_USERNAME/PASSWORD 미설정 — 자동 로그인 불가');
  }
  const page = await browserContext.newPage();
  try {
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // SPA 렌더 + 로그인 상태면 redirect 시간

    // 이미 로그인된 상태면 /login에서 다른 페이지로 redirect됨
    if (!/\/login(\?|$)/.test(page.url())) {
      return false;
    }

    // 로그인 폼 입력
    await page.waitForSelector('#email', { timeout: 10000 });
    await page.fill('#email', username);
    await page.fill('#password', password);
    await page.click('button:has-text("로그인")');

    // /login 벗어날 때까지 대기 (로그인 성공)
    await page.waitForURL(u => !/\/login(\?|$)/.test(u.toString()), { timeout: 20000 });
    console.log('[auth] connect.pluglink.kr 자동 로그인 성공');
    return true;
  } catch (e) {
    throw new Error(`자동 로그인 실패: ${e?.message ?? String(e)}`);
  } finally {
    await page.close();
  }
}
