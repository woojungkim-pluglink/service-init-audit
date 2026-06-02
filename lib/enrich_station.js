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
 * 충전소 메타 블록(주소·프로젝트ID)이 렌더 완료됐는지 판정 (순수, 테스트 가능).
 * 충전기 테이블은 떴지만 충전소 정보 API가 아직 안 온 레이스 상황을 거른다.
 * 보조금 충전소는 항상 projectId가 있으므로 둘 다 있어야 완료로 본다.
 */
export function isStationMetaComplete(meta) {
  return Boolean(meta && meta.address && meta.projectIds && meta.projectIds.length > 0);
}

// 정상 커넥터 상태: '사용가능'(초록) + 사용 중(파란불) = 충전준비/충전중/충전완료.
//   파란불은 충전기가 정상 동작·사용 중인 상태이므로 WARN 대상이 아니다.
//   (비정상: 사용불가/미연결/통신미연결 등)
const NORMAL_CONNECTOR_STATUS = ['사용가능', '충전준비', '충전중', '충전완료'];

/** 커넥터 상태가 정상인지 (공백 제거 후 비교 — "충전 중" 등 표기 흔들림 흡수) */
export function isConnectorStatusNormal(status) {
  const v = (status || '').replace(/\s/g, '');
  return NORMAL_CONNECTOR_STATUS.includes(v);
}

/**
 * 충전기 행 1개의 정상 판정.
 * 정상: 충전기 운영상태='사업개시' && Device 운영상태='운영' && 커넥터 상태 정상(사용가능/충전준비/충전중/충전완료)
 */
export function isChargerNormal(c) {
  return c.operationStatus === '사업개시'
    && c.deviceStatus === '운영'
    && isConnectorStatusNormal(c.connectorStatus);
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

  // 1) 메타데이터 — innerText 기반. 충전소 정보 카드는 충전기 테이블과 별도 비동기
  //    소스라, 신규(cold) 충전소에서는 테이블이 먼저 떠도 메타 블록이 비어있을 수 있다.
  //    메타 완료(주소+프로젝트ID)까지 폴링 — arbitrary sleep 대신 조건 기반 대기.
  let meta;
  const META_RETRIES = 8;
  for (let attempt = 0; attempt < META_RETRIES; attempt++) {
    const text = await page.evaluate(() => document.body.innerText);
    meta = extractStationMeta(text);
    if (isStationMetaComplete(meta)) break;
    if (attempt < META_RETRIES - 1) await page.waitForTimeout(750);
  }
  if (!isStationMetaComplete(meta)) {
    console.warn(`  [enrich ${stationId}] ⚠️ 메타 블록 불완전 (addr=${meta.address ?? 'null'}, projectIds=${meta.projectIds.length}) — 폴링 ${META_RETRIES}회 후에도 미렌더`);
  }

  // 1b) DOM 기반 fallback — 정규식이 못 잡았을 때 h1(충전소명) + 그 다음 div(주소) 직접 추출
  if (!meta.stationName || !meta.address) {
    const dom = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      const name = (h1.textContent || '').trim();
      // h1 다음 sibling 또는 부모의 다음 div에서 주소로 보이는 텍스트 탐색
      const nextDiv = h1.parentElement?.nextElementSibling
        || h1.nextElementSibling;
      let addr = null;
      if (nextDiv) {
        // 첫 자식 div의 텍스트 (스크린샷 패턴: <div><div>주소텍스트</div><a>지도</a></div>)
        const firstChild = nextDiv.querySelector('div') || nextDiv;
        const t = (firstChild.textContent || '').trim();
        // 한국 시도 약자로 시작하면 주소로 간주
        if (/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(t)) {
          addr = t;
        }
      }
      return { name, addr };
    });
    if (dom) {
      meta.stationName = meta.stationName || dom.name || null;
      meta.address = meta.address || dom.addr || null;
    }
  }

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
      initiatedAt: findIdx('서비스 개시일'),
      lastCommunication: findIdx('마지막 통신 시각')
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
        initiatedAt: at(idx.initiatedAt),
        lastCommunication: at(idx.lastCommunication)
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
