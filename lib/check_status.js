import { assertLoggedIn } from './playwright_session.js';

const isNormal = (c) =>
  c.businessStatus === '사업개시' &&
  c.operationStatus === '운영' &&
  c.useStatus === '사용가능';

export function judgeStatus(chargers) {
  if (!chargers || chargers.length === 0) {
    return { status: 'SKIP', evidence: { chargers: [], abnormal: [] }, message: '충전기 정보 없음' };
  }
  const abnormal = chargers.filter(c => !isNormal(c)).map(c => c.deviceId);
  if (abnormal.length === 0) {
    return { status: 'PASS', evidence: { chargers, abnormal: [] }, message: `${chargers.length}대 모두 정상` };
  }
  if (abnormal.length < chargers.length) {
    return { status: 'WARN', evidence: { chargers, abnormal }, message: `${abnormal.length}/${chargers.length}대 비정상` };
  }
  return { status: 'FAIL', evidence: { chargers, abnormal }, message: '전 충전기 비정상' };
}

export async function checkStatus(project, ctx) {
  const { browserContext, plinkconnectBase } = ctx;
  const page = await browserContext.newPage();
  try {
    await page.goto(`${plinkconnectBase}/stations/${project.stationId}`);
    assertLoggedIn(page);
    // TODO(Task 14): 실제 DOM 확인 후 [data-test="charger-row"] 셀렉터 확정
    await page.waitForSelector('[data-test="charger-row"]');
    const rows = await page.$$('[data-test="charger-row"]');
    const chargers = [];
    for (const row of rows) {
      const cells = await row.$$eval('td', tds => tds.map(t => t.textContent.trim()));
      // 셀 순서 가정: deviceId, businessStatus, operationStatus, useStatus
      chargers.push({
        deviceId: cells[0],
        businessStatus: cells[1],
        operationStatus: cells[2],
        useStatus: cells[3]
      });
    }
    return judgeStatus(chargers);
  } catch (e) {
    if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    return { status: 'SKIP', evidence: { error: e.message }, message: `상태 검증 실패: ${e.message.slice(0, 100)}` };
  } finally {
    await page.close();
  }
}
