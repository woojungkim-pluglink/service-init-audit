import { isChargerNormal } from './enrich_station.js';

/**
 * 신규 개시된 충전기 리스트(newChargers)에 대해 정상 판정.
 * 정상: 충전기 운영상태='사업개시' && Device 운영상태='운영' && 커넥터 상태='사용가능'
 */
export function judgeStatus(newChargers) {
  if (!newChargers || newChargers.length === 0) {
    return {
      status: 'SKIP',
      evidence: { newChargers: [], abnormal: [] },
      message: '신규 개시 충전기 정보 없음'
    };
  }
  const snapshot = [...newChargers];
  const abnormal = snapshot.filter(c => !isChargerNormal(c)).map(c => ({
    chargerId: c.chargerId,
    deviceId: c.deviceId,
    operationStatus: c.operationStatus,
    deviceStatus: c.deviceStatus,
    connectorStatus: c.connectorStatus
  }));
  if (abnormal.length === 0) {
    return {
      status: 'PASS',
      evidence: { newChargers: snapshot, abnormal: [] },
      message: `신규 ${snapshot.length}기 모두 정상 (사업개시/운영/사용가능)`
    };
  }
  if (abnormal.length < snapshot.length) {
    return {
      status: 'WARN',
      evidence: { newChargers: snapshot, abnormal },
      message: `신규 ${snapshot.length}기 중 ${abnormal.length}기 비정상`
    };
  }
  return {
    status: 'FAIL',
    evidence: { newChargers: snapshot, abnormal },
    message: `신규 ${snapshot.length}기 전부 비정상`
  };
}

/**
 * 체커 시그니처: (station, ctx) → CheckResult
 * station은 audit.js의 enrichment 단계에서 `newChargers` 필드가 채워져 있어야 함.
 */
export async function checkStatus(station, _ctx) {
  return judgeStatus(station.newChargers || []);
}
