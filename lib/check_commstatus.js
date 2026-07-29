/**
 * 통신 판정 — 온톨로지 정본(operations-cs.function.proactive-fault-detection) 반영:
 *   "통신 SoT = packetReceivedAt(30분 초과=DISCONNECTED). connectionStatus/isConnection 라벨 사용 금지."
 *
 * 1차 판정 = 마지막 통신 시각(실측, lastCommunication).
 *   - 1시간 초과(사용자 정의 개시당일 규칙 — check_status_recent와 동일 임계) → WARN
 *   - 30분~1시간 → 조기경보(온톨로지 30분 기준)로 evidence에만 기록, 상태는 PASS 유지
 * 라벨('통신 상태' 컬럼 = 연결/미연결)은 보조 근거:
 *   - 라벨 미연결인데 시각은 최근 → 라벨-시각 불일치로 WARN(어느 쪽을 믿을지 운영자 판단용 병기)
 * 오탐 가드(온톨로지): RSRP 0/양수/미보고·CTN '-'는 '신호 미보고'로 분류만 하고 단독 승격 금지.
 * 부가: 동일 회선(CTN)을 2대+가 공유하고 그중 단절이 있으면 '모뎀 공유 — 거점 동시단절 위험' 병기.
 *
 * ※ 과거 구현은 커넥터 상태 셀에서 '통신미연결' 문자열을 찾았으나, 실페이지에서 그 값은
 *   커넥터 상태 컬럼에 나타나지 않아(별도 '통신 상태' 컬럼) 체크가 한 번도 발화하지 않았다.
 */
import { parseKstTimestamp } from './check_status_recent.js';

const HOUR_MS = 60 * 60 * 1000;
const EARLY_MS = 30 * 60 * 1000; // 온톨로지 DISCONNECTED 기준(조기경보)

/** '통신 상태' 컬럼 값이 미연결인지 (다구 연접 "연결미연결" 대비 부분 포함 검사) */
export function isDisconnectedLabel(v) {
  return /미\s*연결/.test(String(v || ''));
}

/** RSRP가 유효한 음수 신호값이 아닌 경우(0/양수/미보고) = 신호 미보고 (온톨로지: 0/양수=미수신 제외) */
function isSignalUnreported(c) {
  const raw = String(c.rsrp ?? '').trim();
  if (raw === '' || raw === '-') return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n >= 0;
}

export function judgeCommStatus(station, referenceEpochMs = Date.now()) {
  const chargers = station?.chargers || [];
  if (chargers.length === 0) {
    return { status: 'SKIP', evidence: { reason: 'NO_CHARGERS' }, message: '충전기 목록 없음' };
  }

  const stale = [];        // 시각 1시간 초과 — 주 판정
  const labelOnly = [];    // 라벨 미연결인데 시각은 최근/미상 — 불일치 병기
  const early = [];        // 30분~1시간 — 조기경보(PASS 유지)
  const noSignal = [];     // RSRP·CTN 미보고 — 분류만

  for (const c of chargers) {
    const id = c.chargerId;
    const ts = parseKstTimestamp(c.lastCommunication);
    const age = ts == null ? null : referenceEpochMs - ts;
    const labelDisc = isDisconnectedLabel(c.commStatus);
    if (age != null && age > HOUR_MS) stale.push(id);
    else if (labelDisc) labelOnly.push(id);
    else if (age != null && age > EARLY_MS) early.push(id);
    if (isSignalUnreported(c)) noSignal.push(id);
  }

  // 모뎀 공유(동일 CTN 2대+) 중 단절 포함 → 거점 동시단절 위험
  const disconnected = new Set([...stale, ...labelOnly]);
  const byCtn = new Map();
  for (const c of chargers) {
    const ctn = String(c.ctn || '').trim();
    if (!ctn || ctn === '-') continue;
    if (!byCtn.has(ctn)) byCtn.set(ctn, []);
    byCtn.get(ctn).push(c.chargerId);
  }
  const sharedModemRisk = [...byCtn.entries()]
    .filter(([, ids]) => ids.length >= 2 && ids.some(id => disconnected.has(id)))
    .map(([ctn, ids]) => ({ ctn, chargers: ids }));

  const evidence = {
    total: chargers.length,
    stale, labelOnly, earlyWarning: early, noSignal, sharedModemRisk
  };

  if (stale.length === 0 && labelOnly.length === 0) {
    const earlyNote = early.length ? ` · 조기경보(30분 초과) ${early.length}기: ${early.join(', ')}` : '';
    return { status: 'PASS', evidence, message: `통신 정상 (${chargers.length}기)${earlyNote}` };
  }

  const parts = [];
  if (stale.length) parts.push(`통신 1시간 초과 ${stale.length}기(${stale.join(', ')})`);
  if (labelOnly.length) parts.push(`라벨 미연결(통신은 최근) ${labelOnly.length}기(${labelOnly.join(', ')})`);
  if (sharedModemRisk.length) {
    parts.push(sharedModemRisk.map(r => `모뎀 공유 회선 ${r.ctn}: ${r.chargers.join(', ')} — 거점 동시단절 위험`).join('; '));
  }
  return {
    status: 'WARN',
    evidence,
    message: `통신 이상 ${disconnected.size}/${chargers.length}기 — ${parts.join('; ')}`
  };
}
