import { assertLoggedIn } from './playwright_session.js';

// PLINKCONNECT 충전기 상태 원문 (도메인 상수)
const isNormal = (c) =>
  c.businessStatus === '사업개시' &&
  c.operationStatus === '운영' &&
  c.useStatus === '사용가능';

export function judgeStatus(chargers) {
  if (!chargers || chargers.length === 0) {
    return { status: 'SKIP', evidence: { chargers: [], abnormal: [] }, message: '충전기 정보 없음' };
  }
  // shallow copy로 호출자 변이 차단
  const snapshot = [...chargers];
  const abnormal = snapshot.filter(c => !isNormal(c)).map(c => c.deviceId);
  if (abnormal.length === 0) {
    return { status: 'PASS', evidence: { chargers: snapshot, abnormal: [] }, message: `${snapshot.length}대 모두 정상` };
  }
  if (abnormal.length < snapshot.length) {
    return { status: 'WARN', evidence: { chargers: snapshot, abnormal }, message: `${abnormal.length}/${snapshot.length}대 비정상` };
  }
  // 전부 비정상
  return { status: 'FAIL', evidence: { chargers: snapshot, abnormal }, message: '전 충전기 비정상' };
}

export async function checkStatus(project, ctx) {
  const { browserContext, plinkconnectBase } = ctx;
  const page = await browserContext.newPage();
  try {
    await page.goto(`${plinkconnectBase}/stations/${project.stationId}`);
    assertLoggedIn(page); // assertLoggedIn은 동기 함수 (Task 4)
    // TODO(Task 14): 실제 DOM 확인 후 [data-test="charger-row"] 셀렉터 확정
    await page.waitForSelector('[data-test="charger-row"]');
    const rows = await page.$$('[data-test="charger-row"]');
    const chargers = [];
    for (const row of rows) {
      const cells = await row.$$eval('td', tds => tds.map(t => t.textContent.trim()));
      // TODO(Task 14): 셀 순서도 실 DOM 확인 — deviceId[0], businessStatus[1], operationStatus[2], useStatus[3]
      chargers.push({
        deviceId: cells[0],
        businessStatus: cells[1],
        operationStatus: cells[2],
        useStatus: cells[3]
      });
    }
    return judgeStatus(chargers);
  } catch (e) {
    if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    const msg = (e?.message ?? String(e)).slice(0, 100);
    return { status: 'SKIP', evidence: { error: msg }, message: `상태 검증 실패: ${msg}` };
  } finally {
    await page.close();
  }
}
