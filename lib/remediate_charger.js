/**
 * 충전기 원격제어 자동 조치 — "미운영이지만 최근 통신 중"인 충전기를 운영으로 전환.
 *
 * 사용자 정의 조치:
 *   상태 체크 WARN(미운영 충전기 존재) 시, 각 충전기의 마지막 통신이 기준시각 1시간 이내인데
 *   Device 운영상태만 '미운영'이면 → 원격제어(운영여부 변경 → 운영) 실행 후 재조회로 전환 확인.
 *
 * 플링커넥트 충전소 home 페이지 원격제어 모달 흐름(인스펙트로 확인):
 *   - 충전기 선택: label[for="check-{chargerId}"] 클릭 (input#check-{id}는 숨김)
 *   - 원격제어 버튼 → ReactModal [role=dialog]
 *   - 제어 명령 native select → value 'CHANGE_AVAILABILITY' (운영여부 변경)
 *   - 상태 라디오 input[type=radio][value="OPERATION"] (운영) / 'NON_OPERATION' (미운영)
 *   - 저장 button[type=submit] / 취소 button[type=button]
 */
import { parseKstTimestamp } from './check_status_recent.js';
import { fetchStationData } from './enrich_station.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * 원격제어 대상 선별 (순수, 테스트 대상).
 * 조건: Device 운영상태='미운영' AND 마지막 통신이 기준시각 1시간 이내(실제 온라인).
 * @param {Array<{chargerId, deviceId, deviceStatus, lastCommunication}>} chargers
 * @param {number} referenceEpochMs
 * @param {number} withinMs
 */
export function pickRemediationTargets(chargers, referenceEpochMs, withinMs = ONE_HOUR_MS) {
  const ref = referenceEpochMs;
  const out = [];
  for (const c of chargers || []) {
    if (c.deviceStatus !== '미운영') continue;
    const ts = parseKstTimestamp(c.lastCommunication);
    if (ts == null) continue;
    const age = ref - ts;
    if (age >= 0 && age <= withinMs) out.push(c);
  }
  return out;
}

/**
 * 충전기 1대 원격제어(운영여부 변경 → 운영) + 재조회 확인.
 * @returns {{chargerId, deviceId, before, action, after, ok, executed, error?}}
 */
export async function executeRemoteControl(page, stationId, charger, base) {
  const url = `${base}/operation/stations/${stationId}/home`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('table thead th')).some(th => /충전기\s*ID/.test(th.textContent || '')),
    { timeout: 15000 }
  );
  await page.waitForTimeout(1000);

  // 1) 대상 충전기 선택 (label 클릭 — input은 숨김)
  await page.locator(`label[for="check-${charger.chargerId}"]`).click({ timeout: 8000 });
  // 2) 원격제어 모달 오픈
  await page.getByRole('button', { name: /원격제어/ }).click({ timeout: 8000 });
  const dialog = page.locator('[role=dialog]');
  await dialog.waitFor({ state: 'visible', timeout: 8000 });

  // 3) 안전장치: 모달의 Device row가 대상 deviceId와 일치하는지 확인 후에만 진행
  const rowText = (await dialog.locator('tbody').innerText().catch(() => '')) || '';
  if (charger.deviceId && !rowText.includes(charger.deviceId)) {
    await dialog.getByRole('button', { name: /취소/ }).click({ timeout: 3000 }).catch(() => {});
    throw new Error(`모달 대상 불일치(modal="${rowText.replace(/\s+/g, ' ').trim()}" expect=${charger.deviceId}) — 저장 중단`);
  }

  // 4) 제어 명령 = 운영여부 변경, 상태 = 운영
  await dialog.locator('select').selectOption('CHANGE_AVAILABILITY', { timeout: 5000 });
  await dialog.locator('input[type=radio][value="OPERATION"]').check({ force: true, timeout: 5000 });
  // 5) 저장
  await dialog.locator('button[type=submit]').click({ timeout: 5000 });
  await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

  // 6) 재조회 확인 — 명령 반영까지 시간이 걸릴 수 있어 폴링
  let after = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(attempt === 0 ? 3000 : 5000);
    try {
      const data = await fetchStationData(page, stationId, base);
      after = (data.chargers || []).find(c => c.chargerId === charger.chargerId)?.deviceStatus ?? null;
    } catch { /* 재시도 */ }
    if (after === '운영') break;
  }

  return {
    chargerId: charger.chargerId,
    deviceId: charger.deviceId,
    before: '미운영',
    action: 'CHANGE_AVAILABILITY→OPERATION',
    after,
    ok: after === '운영',
    executed: true
  };
}

/**
 * 충전소 단위 조치. 대상이 없으면 I/O 없이 즉시 반환.
 * @param {object} ctx — { browserContext, plinkconnectBase }
 * @param {object} station — { stationId, chargers }
 * @param {{dryRun?: boolean, referenceEpochMs?: number}} opts
 */
export async function remediateStation(ctx, station, { dryRun = false, referenceEpochMs } = {}) {
  const ref = referenceEpochMs ?? Date.now();
  const targets = pickRemediationTargets(station.chargers || [], ref);
  if (targets.length === 0) return { targets: 0, results: [] };

  const base = ctx.plinkconnectBase || 'https://connect.pluglink.kr';
  const results = [];
  for (const t of targets) {
    if (dryRun) {
      results.push({
        chargerId: t.chargerId, deviceId: t.deviceId, lastCommunication: t.lastCommunication,
        before: '미운영', action: 'CHANGE_AVAILABILITY→OPERATION', executed: false, dryRun: true
      });
      continue;
    }
    const page = await ctx.browserContext.newPage();
    try {
      results.push(await executeRemoteControl(page, station.stationId, t, base));
    } catch (e) {
      results.push({
        chargerId: t.chargerId, deviceId: t.deviceId, before: '미운영',
        action: 'CHANGE_AVAILABILITY→OPERATION', executed: false, ok: false,
        error: (e?.message ?? String(e)).slice(0, 150)
      });
    } finally {
      await page.close();
    }
  }
  return { targets: targets.length, results };
}
