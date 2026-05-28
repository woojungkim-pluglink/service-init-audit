/**
 * projectId → stationId 매핑.
 * /manage/projects/{projectId}/construction 페이지에서 충전소 링크 추출.
 */
import { assertLoggedIn } from './playwright_session.js';

/**
 * @param {import('playwright').BrowserContext} browserContext
 * @param {string} projectId
 * @param {string} plinkconnectBase
 * @returns {Promise<string|null>} stationId 또는 null
 */
export async function resolveStationIdByProjectId(browserContext, projectId, plinkconnectBase) {
  const page = await browserContext.newPage();
  try {
    const url = `${plinkconnectBase}/manage/projects/${projectId}/construction`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assertLoggedIn(page);
    await page.waitForTimeout(2000);
    const stationIds = await page.$$eval('a', els => [...new Set(
      els.map(e => e.href)
        .map(h => (h.match(/\/operation\/stations\/(\d+)/) || [])[1])
        .filter(Boolean)
    )]);
    return stationIds[0] || null;
  } finally {
    await page.close();
  }
}
