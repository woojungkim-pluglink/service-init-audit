import { assertLoggedIn } from './playwright_session.js';

const STATION_ID_RE = /충전소\s*ID\s+(\d+)/;
const PROJECT_IDS_RE = /프로젝트\s*ID\s+([\d\s,]+?)(?:\s+(?:충전소\s*상태|건물구분|위치)|$)/;

// 한국 17개 광역시도 약자 (플링커넥트 주소 표기 기준)
const SIDO = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';
// "충전소 상세 운영 <name> <SIDO> ..." 또는 "운영 <name> <SIDO> ..."
const STATION_NAME_RE = new RegExp(`충전소\\s+상세\\s+(?:운영|미운영|폐쇄)\\s+(.+?)\\s+(?:${SIDO})\\s`);
// 주소: SIDO부터 다음 keyword 직전까지
const ADDRESS_RE = new RegExp(`((?:${SIDO})\\s+.+?)\\s+(?:충전기\\s*수|최근\\s*30일)`);

/**
 * 페이지 innerText에서 충전소 메타데이터 추출 (순수, 테스트 가능).
 * @returns {{ stationName, address, stationId, projectIds }}
 */
export function extractStationMeta(text) {
  const stationIdMatch = text.match(STATION_ID_RE);
  const projectIdsRaw = text.match(PROJECT_IDS_RE)?.[1] ?? '';
  const projectIds = projectIdsRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s));
  const stationNameMatch = text.match(STATION_NAME_RE);
  const stationName = stationNameMatch?.[1]?.trim() ?? null;
  const addressMatch = text.match(ADDRESS_RE);
  const address = addressMatch?.[1]?.trim() ?? null;
  return {
    stationName,
    address,
    stationId: stationIdMatch?.[1] ?? null,
    projectIds
  };
}

/**
 * 충전기 행 1개의 정상 판정.
 * 사용자 정의 정상: 충전기 운영상태='사업개시' && Device 운영상태='운영' && 커넥터 상태='사용가능'
 */
export function isChargerNormal(c) {
  return c.operationStatus === '사업개시'
    && c.deviceStatus === '운영'
    && c.connectorStatus === '사용가능';
}

/**
 * Playwright 페이지에서 충전소 정보 + 충전기 리스트 fetch.
 * @returns {{
 *   stationName, address, stationId, projectIds,
 *   chargers: Array<{chargerId, operationStatus, deviceStatus, deviceId, connectorStatus, appliedRate, initiatedAt}>
 * }}
 */
export async function fetchStationData(page, stationId, plinkconnectBase) {
  const url = `${plinkconnectBase}/operation/stations/${stationId}/home`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`  [enrich ${stationId}] after goto url=${page.url()}`);
  // 진단 코드와 동일한 시점에 인증 체크 (SPA가 client redirect하기 전)
  assertLoggedIn(page);
  // SPA 클라이언트 렌더 대기 — inspect_station_page와 동일 패턴
  await page.waitForTimeout(2000);
  console.log(`  [enrich ${stationId}] after 2s wait url=${page.url()}`);
  // 충전기 리스트 헤더("충전기 ID") 출현까지 대기 — 다른 테이블 매칭 방지
  try {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('table thead th'))
        .some(th => /충전기\s*ID/.test(th.textContent || '')),
      { timeout: 15000 }
    );
  } catch (e) {
    assertLoggedIn(page); // 셀렉터 못 찾으면 인증 만료 가능성부터 재확인
    throw new Error(`충전기 테이블 헤더 못 찾음 (url=${page.url()})`);
  }

  // 1) 메타데이터 — innerText 기반
  const text = await page.evaluate(() => document.body.innerText);
  const meta = extractStationMeta(text);

  // 2) 충전기 리스트 — 헤더 매칭 → 컬럼 인덱스 결정 → 행별 추출
  const chargers = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    // 충전기 리스트 테이블 식별: thead에 "충전기 ID" 헤더 포함
    const table = tables.find(t =>
      Array.from(t.querySelectorAll('thead th')).some(th => /충전기\s*ID/.test(th.textContent))
    );
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th'))
      .map(th => th.textContent.replace(/\s+/g, ' ').trim());
    const findIdx = (label) => headers.findIndex(h => h.includes(label));
    const idx = {
      chargerId: findIdx('충전기 ID'),
      operationStatus: findIdx('충전기 운영상태'),
      deviceStatus: findIdx('Device 운영상태'),
      deviceId: findIdx('Device ID'),
      connectorStatus: findIdx('커넥터 상태'),
      appliedRate: findIdx('적용중인 요금제'),
      initiatedAt: findIdx('서비스 개시일')
    };
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g, ' ').trim());
      const at = (i) => i >= 0 ? cells[i] : '';
      return {
        chargerId: at(idx.chargerId),
        operationStatus: at(idx.operationStatus),
        deviceStatus: at(idx.deviceStatus),
        deviceId: at(idx.deviceId),
        connectorStatus: at(idx.connectorStatus),
        appliedRate: at(idx.appliedRate),
        initiatedAt: at(idx.initiatedAt)
      };
    });
  });

  return { ...meta, chargers };
}

/**
 * fetchStationData 결과에서 "오늘 개시된 충전기" 만 필터.
 */
export function filterNewChargers(chargers, today) {
  return chargers.filter(c => c.initiatedAt === today);
}
