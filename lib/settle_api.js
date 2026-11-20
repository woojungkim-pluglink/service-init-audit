/**
 * 실시간 충전기 상태 위젯 API 클라이언트 — 플링커넥트 Managements BFF(apis.pluglink.kr).
 *
 * 2026-11 경로 이전: 구 search.pluglink.kr/v101/dashboards/status/{accumulations|devices?statusType=}
 *   는 11-10~11-20 사이 폐기됐다(API Gateway 403 'Missing Authentication Token' — 10-30 폐기된
 *   extract.pluglink.kr 과 같은 응답). 커넥트 홈 화면도 아래 BFF 경로로 옮겨 갔다.
 * 실측 사실(2026-11-20):
 *   - 카운터: GET /chargers/status/counts → data {failedConnection, failedUsable, isError} (구 accumulations 와 같은 키)
 *   - 목록: GET /chargers/status?page&size&<필터> → data = Spring 페이지(content·totalPages·number…), 충전기 문서 형태는 구 API와 같다.
 *   - 필터는 커넥트 프론트와 같다(STATUS_FILTERS). 필터별 totalElements 가 카운터 값과 일치함을 확인(547/73/64).
 *   - page 파라미터는 1-based (page=0 → HTTP 400). 응답 number는 0-based. size=100 정상.
 *   - 인증은 connect localStorage 'token'의 JWT(만료 약 24h).
 * fetchImpl 주입은 테스트용 — 운영은 Node 20+ 글로벌 fetch.
 */

const STATUS_API = 'https://apis.pluglink.kr/v101/managements/chargers/status';

/** 위젯 3종 → 목록 필터 (커넥트 프론트 getChargersStatus 와 동일) */
const STATUS_FILTERS = {
  failedConnection: 'packetReceivedAt=now-30m/m',          // 30분 이상 통신 미연결
  failedUsable: 'devices.connectors.status=Unavailable,Faulted', // 사용불가
  isError: 'devices.connectors.isError=true'                // 에러
};

function apiHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'x-channel': 'PLUGLINK',
    'x-platform': 'WEB',
    'x-token': 'PLUGLINK'
  };
}

/** 커넥트 SPA localStorage에서 JWT 추출 — ensureSession(로그인 보장) 이후 호출 전제 */
export async function extractConnectToken(browserContext, base) {
  const page = await browserContext.newPage();
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // SPA 부트스트랩 대기
    const token = await page.evaluate(() => localStorage.getItem('token'));
    if (!token || !token.startsWith('eyJ')) {
      throw new Error('connect JWT 추출 실패 — localStorage.token 없음 (로그인 상태 확인 필요)');
    }
    return token;
  } finally { await page.close(); }
}

/** 위젯 3종 카운터 */
export async function fetchAccumulations(token, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${STATUS_API}/counts`, { headers: apiHeaders(token) });
  if (!r.ok) throw new Error(`status counts HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.data) throw new Error('accumulations 응답에 data 없음');
  return j.data;
}

/** 이상 목록 전체 수집 (1-based 페이징). 상한 도달 시 truncated=true — 조용한 절단 금지 */
export async function fetchStatusDevices(token, statusType, { size = 100, maxPages = 60, fetchImpl = fetch } = {}) {
  const filter = STATUS_FILTERS[statusType];
  if (!filter) throw new Error(`알 수 없는 statusType: ${statusType}`);
  const items = [];
  let totalPages = 1;
  let prevFirstId = null;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const url = `${STATUS_API}?page=${page}&size=${size}&${filter}`;
    const r = await fetchImpl(url, { headers: apiHeaders(token) });
    if (!r.ok) throw new Error(`devices(${statusType}) p${page} HTTP ${r.status}`);
    const d = (await r.json())?.data;
    if (!d || !Array.isArray(d.content)) throw new Error(`devices(${statusType}) p${page} 응답 형식 이상`);
    const firstId = d.content[0]?.id ?? null;
    // page 파라미터가 무시되면 같은 페이지가 반복된다 — 무한 중복 수집 대신 즉시 실패
    if (page > 1 && firstId != null && firstId === prevFirstId) {
      throw new Error(`devices(${statusType}) 페이징 미진행(p${page} 첫 항목 동일) — page 파라미터 확인 필요`);
    }
    prevFirstId = firstId;
    items.push(...d.content);
    totalPages = d.totalPages ?? 1;
  }
  return { items, truncated: totalPages > maxPages };
}

/** 라이브 대시보드의 직전 settle.json — diff 기준. 404·실패는 null(최초 실행 취급) */
export async function fetchLiveSettle(dashboardUrl, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${dashboardUrl}/data/settle.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
