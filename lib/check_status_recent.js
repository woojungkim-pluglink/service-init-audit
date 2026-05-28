/**
 * "마지막 통신 시각" 기반 충전기 상태 검증 (내일 개시 예정 충전소용).
 *
 * 사용자 정의:
 *   "각 충전기의 마지막 통신일자가 체크기준시점으로부터 1시간 이내여야 함"
 *
 * - PASS: 모든 충전기의 마지막 통신이 1시간 이내
 * - WARN: 일부만 통신 불량
 * - FAIL: 전부 통신 불량
 * - SKIP: 충전기 정보 없음
 */

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * "2026-05-22 17:01:59" 같은 KST 시각 → epoch ms.
 * 빈 값/유효하지 않은 값은 null.
 */
export function parseKstTimestamp(s) {
  if (!s) return null;
  const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  // KST(+09:00) 기준 → UTC 환산
  return Date.UTC(+y, +mo - 1, +d, +h - 9, +mi, +sec);
}

/**
 * @param {Array<{chargerId, deviceId, lastCommunication}>} chargers
 * @param {number} referenceEpochMs — 체크 기준 시각 (epoch ms)
 */
export function judgeStatusRecent(chargers, referenceEpochMs) {
  if (!chargers || chargers.length === 0) {
    return {
      status: 'SKIP',
      evidence: { chargers: [], stale: [] },
      message: '충전기 정보 없음'
    };
  }
  const snapshot = [...chargers];
  const stale = [];
  for (const c of snapshot) {
    const ts = parseKstTimestamp(c.lastCommunication);
    const ageMs = ts == null ? Infinity : (referenceEpochMs - ts);
    const isRecent = ts != null && ageMs >= 0 && ageMs <= ONE_HOUR_MS;
    if (!isRecent) {
      stale.push({
        chargerId: c.chargerId,
        deviceId: c.deviceId,
        lastCommunication: c.lastCommunication || null,
        ageMs: ts == null ? null : ageMs
      });
    }
  }
  if (stale.length === 0) {
    return {
      status: 'PASS',
      evidence: { chargers: snapshot, stale: [] },
      message: `${snapshot.length}기 모두 1시간 이내 통신`
    };
  }
  if (stale.length < snapshot.length) {
    return {
      status: 'WARN',
      evidence: { chargers: snapshot, stale },
      message: `${snapshot.length}기 중 ${stale.length}기 통신 불량(1시간 초과)`
    };
  }
  return {
    status: 'FAIL',
    evidence: { chargers: snapshot, stale },
    message: `${snapshot.length}기 전부 통신 불량`
  };
}

/**
 * 체커 시그니처. station에 .chargers (전체 충전기 — 신규 아님)와 .referenceEpochMs 필요.
 */
export async function checkStatusRecent(station, _ctx) {
  const ref = station.referenceEpochMs ?? Date.now();
  return judgeStatusRecent(station.chargers || [], ref);
}
