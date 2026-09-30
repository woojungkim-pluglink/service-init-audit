/**
 * 개시 후 30일 정착 추적(settle) — 순수 로직 (I/O 없음).
 *
 * 데이터 소스: 플링커넥트 "실시간 충전기 상태" 위젯 API의 charger 문서.
 * 온톨로지 정본(operations-cs.function.proactive-fault-detection) 반영:
 *   - 통신 판정은 packetReceivedAt 실측만 (connectionStatus/isConnection 라벨 사용 금지)
 *   - RSRP 0/양수/미보고 = '신호 미보고' 분류만 (단독 승격 금지)
 *   - CPO partnerId=1(플러그링크) 한정, (테스트) 충전소 제외
 * 공개 대시보드 게시물이므로 finalizeItem에서 내부정보(dial 원본·IP)를 제거한다.
 */
import { parseKstTimestamp } from './check_status_recent.js';

export const STATUS_TYPES = ['failedConnection', 'failedUsable', 'isError'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 개시일→오늘 날짜 차이(일). KST 날짜 문자열 전제, 형식 오류는 null */
export function dPlusOf(launchedAt, today) {
  const lymd = String(launchedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lymd) || !/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ''))) return null;
  const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(today) - toUtc(lymd)) / DAY_MS);
}

/** 마지막 패킷 수신 이후 경과 구간. 파싱 불가 시 bucket=null */
export function classifyOutage(packetReceivedAt, refEpochMs) {
  const ts = parseKstTimestamp(packetReceivedAt);
  if (ts == null) return { bucket: null, ms: null };
  const ms = refEpochMs - ts;
  const bucket = ms < HOUR_MS ? 'lt1h' : ms < DAY_MS ? 'h1d24' : ms < 7 * DAY_MS ? 'd1d7' : 'gt7d';
  return { bucket, ms };
}

/** CTN 마스킹 — 공개 대시보드용 (뒤 4자리만) */
export function maskCtn(dial) {
  const s = String(dial ?? '').trim();
  if (!s || s === '-') return null;
  return '****' + s.slice(-4);
}

/** RSRP 0/양수/미보고 = 신호 미보고 (check_commstatus.js와 동일 기준) */
function isSignalUnreported(rsrp) {
  const raw = String(rsrp ?? '').trim();
  if (raw === '' || raw === '-') return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n >= 0;
}

/** devices[] 중 대표 장비 — 마지막 통신이 가장 최근인 것 (교체 이력 대비) */
function pickDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (list.length <= 1) return list[0] ?? null;
  return [...list].sort((a, b) =>
    (parseKstTimestamp(b?.packetReceivedAt) ?? 0) - (parseKstTimestamp(a?.packetReceivedAt) ?? 0))[0];
}

/** API 원시 charger 문서 → 내부 표현. _dial은 모뎀 공유 계산용 — finalizeItem에서 제거 */
export function normalizeItem(rawDoc, type) {
  const dev = pickDevice(rawDoc.devices);
  return {
    chargerId: rawDoc.id,
    deviceId: dev?.deviceId ?? null,
    stationId: rawDoc.station?.id ?? null,
    stationName: rawDoc.station?.name ?? null,
    address: rawDoc.station?.roadNameAddress ?? rawDoc.station?.address ?? null,
    launchedAt: String(rawDoc.launchedAt ?? '').slice(0, 10) || null,
    types: [type],
    operationStatus: rawDoc.operationStatus ?? null,
    packetReceivedAt: rawDoc.packetReceivedAt ?? dev?.packetReceivedAt ?? null,
    deviceStatus: dev?.status ?? null,
    errorCode: dev?.errorCode ?? null,
    signalUnreported: isSignalUnreported(dev?.rsrp),
    cpoPartnerId: rawDoc.cpo?.partnerId ?? null,
    _dial: dev?.dial ?? null
  };
}

/** 3종 목록 병합 — 같은 충전기가 복수 유형이면 types 누적 (STATUS_TYPES 순서 유지) */
export function mergeByCharger(byType) {
  const map = new Map();
  for (const type of STATUS_TYPES) {
    for (const rawDoc of byType[type] ?? []) {
      const prev = map.get(rawDoc.id);
      if (prev) { if (!prev.types.includes(type)) prev.types.push(type); }
      else map.set(rawDoc.id, normalizeItem(rawDoc, type));
    }
  }
  return [...map.values()];
}

/** 추적 대상 필터. CPO 미상(null)은 우리 자산 확증 불가 → 파트너 취급 제외 */
export function filterTracked(items, { today, windowDays = 30 }) {
  const excluded = { partnerCpo: 0, outsideWindow: 0, testStation: 0, noLaunchedAt: 0 };
  const tracked = [];
  for (const it of items) {
    if (it.cpoPartnerId !== 1) { excluded.partnerCpo++; continue; }
    if (/\(\s*테스트\s*\)/.test(it.stationName ?? '')) { excluded.testStation++; continue; }
    const d = dPlusOf(it.launchedAt, today);
    if (d == null) { excluded.noLaunchedAt++; continue; }
    if (d < 0 || d > windowDays) { excluded.outsideWindow++; continue; }
    tracked.push({ ...it, dPlus: d });
  }
  return { tracked, excluded };
}

/**
 * 모뎀 공유 위험 — 동일 dial(CTN) 2대+ 공유 시 거점 동시단절 위험.
 * 분모는 추적 대상이 아닌 '전체 이상 목록'(창 밖 기축 충전기와의 공유도 위험이므로).
 */
export function markSharedModemRisk(tracked, allItems) {
  const count = new Map();
  for (const it of allItems) {
    const d = String(it._dial ?? '').trim();
    if (!d || d === '-') continue;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  for (const it of tracked) {
    const d = String(it._dial ?? '').trim();
    it.sharedModemRisk = !!d && d !== '-' && (count.get(d) ?? 0) >= 2;
  }
  return tracked;
}

/** 공개 게시용 최종 항목 — 내부 필드(_dial, cpoPartnerId) 제거 + CTN 마스킹 */
export function finalizeItem(it, refEpochMs) {
  const isConn = it.types.includes('failedConnection');
  const { bucket, ms } = isConn ? classifyOutage(it.packetReceivedAt, refEpochMs) : { bucket: null, ms: null };
  return {
    chargerId: it.chargerId,
    deviceId: it.deviceId,
    stationId: it.stationId,
    stationName: it.stationName,
    address: it.address,
    launchedAt: it.launchedAt,
    dPlus: it.dPlus,
    types: it.types,
    operationStatus: it.operationStatus,
    packetReceivedAt: it.packetReceivedAt,
    outageBucket: bucket,
    outageMs: ms,
    deviceStatus: it.deviceStatus,
    errorCode: it.errorCode,
    signalUnreported: it.signalUnreported,
    ctnMasked: maskCtn(it._dial),
    sharedModemRisk: !!it.sharedModemRisk
  };
}

/** settle.json 스냅샷 생성 (diff·prevRunAt은 호출측에서 채움) */
export function buildSnapshot({ byType, accumulations, date, slot, runAt, refEpochMs, windowDays = 30, truncated = false }) {
  const all = mergeByCharger(byType);
  const { tracked, excluded } = filterTracked(all, { today: date, windowDays });
  markSharedModemRisk(tracked, all);
  const items = tracked
    .map(it => finalizeItem(it, refEpochMs))
    .sort((a, b) => a.dPlus - b.dPlus || a.chargerId - b.chargerId);
  return {
    runAt, date, slot, windowDays,
    accumulations: accumulations ?? null,
    fetched: { total: all.length, truncated },
    excluded,
    items,
    diff: null,
    prevRunAt: null,
    error: null
  };
}

/** 직전 스냅샷 대비: 신규 진입·복구. 창 이탈(에이징아웃)은 복구로 세지 않는다 */
export function diffSnapshots(prev, next) {
  if (!prev) return { newEntries: (next.items ?? []).map(i => i.chargerId), recovered: [] };
  const prevIds = new Set((prev.items ?? []).map(i => i.chargerId));
  const nextIds = new Set((next.items ?? []).map(i => i.chargerId));
  const newEntries = (next.items ?? [])
    .filter(i => !prevIds.has(i.chargerId))
    .map(i => i.chargerId);
  const gap = Math.max(0, dPlusOf(prev.date, next.date) ?? 0);
  const win = next.windowDays ?? 30;
  const recovered = (prev.items ?? [])
    .filter(i => !nextIds.has(i.chargerId))
    .filter(i => (i.dPlus ?? 0) + gap <= win)
    .map(i => ({ chargerId: i.chargerId, stationName: i.stationName, types: i.types }));
  return { newEntries, recovered };
}

// ── 일별 스냅샷 ──────────────────────────────────────────────
// settle.json 은 매 실행 덮어쓰는 '최신본'이라 과거 상태가 남지 않는다.
// 날짜별 파일을 따로 남겨 대시보드에서 그날의 정착 추적 목록을 되돌아볼 수 있게 한다.
// 같은 날 저녁 실행은 아침 파일을 덮어쓴다 → 그날의 최종 상태가 남는다.

const DAILY_RE = /^(\d{4}-\d{2}-\d{2})-settle\.json$/;

/** 일별 스냅샷 파일명 — retention.js 의 날짜 접두 규칙에 맞춰 90일 보존이 자동 적용된다 */
export function dailySettleFile(date) {
  return `${date}-settle.json`;
}

/** 오늘보다 이전의 가장 최근 일별 스냅샷 파일명 (없으면 null). 당일 파일은 제외한다. */
export function pickPrevDailyFile(fileNames, today) {
  const prev = (fileNames || [])
    .map(f => f.match(DAILY_RE))
    .filter(m => m && m[1] < today)
    .map(m => m[1])
    .sort();
  return prev.length ? dailySettleFile(prev[prev.length - 1]) : null;
}

/**
 * 일별 스냅샷 생성 — 신규·복구를 '전날 스냅샷' 대비로 다시 계산한다.
 * 최신본(settle.json)의 diff 는 직전 실행 대비라 저녁 실행이면 '아침 이후 반나절 변화'밖에 안 된다.
 * 날짜별로 되돌아볼 때 의미 있는 건 '전날 대비 오늘 들어온 것·빠진 것'이다.
 * 전날 스냅샷이 없으면(기능 도입 첫날 등) 직전 실행 대비 diff 를 그대로 쓴다. 원본은 변형하지 않는다.
 */
export function buildDailySnapshot(snapshot, prevDaily) {
  if (!prevDaily) return { ...snapshot, diffBase: 'prev-run' };
  return {
    ...snapshot,
    diff: diffSnapshots(prevDaily, snapshot),
    prevRunAt: prevDaily.runAt ?? null,
    diffBase: prevDaily.date ?? null
  };
}
