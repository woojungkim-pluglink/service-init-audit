import { assertLoggedIn } from './playwright_session.js';

/**
 * 순수 판정 함수 (테스트 대상)
 * - 특가 여부: contractRateName에 "특가" 포함 시
 * - 합의서 검사: 특가이면 hasSpecialAgreementFile === true 필요
 * - 충전기 대칭차집합: appliedChargers ↔ projectChargers 불일치 시 FAIL
 */
export function judgeRate({ contractRateName, hasSpecialAgreementFile, appliedChargers, projectChargers }) {
  const isSpecial = /특가/.test(contractRateName);
  const aSet = new Set(appliedChargers);
  const pSet = new Set(projectChargers);
  const diff = [
    ...projectChargers.filter(d => !aSet.has(d)),
    ...appliedChargers.filter(d => !pSet.has(d))
  ];

  const evidence = { contractRateName, hasSpecialAgreementFile, appliedChargers, projectChargers, diff };

  if (isSpecial && !hasSpecialAgreementFile) {
    return { status: 'FAIL', evidence, message: '특가요금이지만 합의서 파일 없음' };
  }
  if (diff.length > 0) {
    return { status: 'FAIL', evidence, message: `요금제 적용 충전기 불일치 (${diff.length}대)` };
  }
  return {
    status: 'PASS',
    evidence,
    message: `${projectChargers.length}개 전부 매칭${isSpecial ? ', 특가합의서 확인' : ''}`
  };
}

/**
 * 플링커넥트 페이지 스크래핑하여 요금제 3단 매칭 검증.
 *
 * NOTE: [data-test="..."] 셀렉터는 모두 placeholder입니다.
 *       Task 14에서 실제 DOM 확인 후 확정해야 합니다.
 *
 * @param {object} project  { projectId, stationId }
 * @param {object} ctx      { browserContext, plinkconnectBase }
 * @returns {Promise<{ status: 'PASS'|'FAIL'|'SKIP', evidence: object, message: string }>}
 */
export async function checkRate(project, ctx) {
  const { browserContext, plinkconnectBase } = ctx;
  const page = await browserContext.newPage();
  try {
    // 1) 계약탭: 요금제명 + 특가합의서 첨부 여부
    await page.goto(`${plinkconnectBase}/projects/${project.projectId}?tab=contract`);
    // assertLoggedIn은 동기 함수 (Task 4 refactor 후) — await 불필요
    assertLoggedIn(page);
    // TODO(Task 14): 실제 셀렉터로 교체 — [data-test="rate-name"] 은 placeholder
    const contractRateName = await page
      .locator('[data-test="rate-name"]')
      .textContent({ timeout: 10000 })
      .then(t => t.trim());
    // TODO(Task 14): 실제 셀렉터로 교체 — [data-test="attachments"] 은 placeholder
    const hasSpecialAgreementFile = await page
      .locator('[data-test="attachments"] a[href$=".pdf"], [data-test="attachments"] a[href$=".png"], [data-test="attachments"] a[href$=".jpg"]')
      .count()
      .then(n => n > 0);

    // 2) 충전소 요금제탭: 해당 요금제에 적용된 충전기 목록
    await page.goto(`${plinkconnectBase}/stations/${project.stationId}?tab=rate`);
    // TODO(Task 14): 실제 셀렉터로 교체 — [data-test="rate-row"] / "자세히" 버튼 은 placeholder
    await page
      .getByText(contractRateName)
      .locator('xpath=ancestor::*[contains(@data-test,"rate-row")]//button[contains(., "자세히")]')
      .click();
    // TODO(Task 14): 실제 셀렉터로 교체 — [data-test="rate-detail-row"] 은 placeholder
    await page.waitForSelector('[data-test="rate-detail-row"]');
    const appliedChargers = await page.locator('[data-test="rate-detail-row"]').allTextContents();

    // 3) 프로젝트 서비스개시 탭: 개시 처리된 충전기 목록
    await page.goto(`${plinkconnectBase}/projects/${project.projectId}?tab=init`);
    // TODO(Task 14): 실제 셀렉터로 교체 — [data-test="init-charger-row"] 은 placeholder
    await page.waitForSelector('[data-test="init-charger-row"]');
    const projectChargers = await page.locator('[data-test="init-charger-row"]').allTextContents();

    return judgeRate({
      contractRateName,
      hasSpecialAgreementFile,
      appliedChargers: appliedChargers.map(s => s.trim()),
      projectChargers: projectChargers.map(s => s.trim())
    });
  } catch (e) {
    if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    return {
      status: 'SKIP',
      evidence: { error: e.message },
      message: `요금제 검증 실패: ${e.message.slice(0, 100)}`
    };
  } finally {
    await page.close();
  }
}
