import { isChargerNormal } from './enrich_station.js';

/**
 * 신규 개시된 충전기 리스트(newChargers)에 대해 정상 판정.
 * 정상: 충전기 운영상태='사업개시' && Device 운영상태='운영' && 커넥터 상태='사용가능'
 * + 충전소 상태 축: 개시 전이는 charger+station+availability 3원이 각각 별도 SNS로 이동
 *   (온톨로지 charging-core.flow.charger-operation-lifecycle) — 충전기만 개시되고 충전소가
 *   미운영/폐쇄로 남는 부분 실패를 감지. 관측 사례 0건 상태라 우선 WARN(첫 적발 후 FAIL 승격 검토).
 */
export function judgeStatus(newChargers, stationStatus = null) {
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
  let result;
  if (abnormal.length === 0) {
    result = {
      status: 'PASS',
      evidence: { newChargers: snapshot, abnormal: [] },
      message: `신규 ${snapshot.length}기 모두 정상 (사업개시/운영/사용가능)`
    };
  } else if (abnormal.length < snapshot.length) {
    result = {
      status: 'WARN',
      evidence: { newChargers: snapshot, abnormal },
      message: `신규 ${snapshot.length}기 중 ${abnormal.length}기 비정상`
    };
  } else {
    result = {
      status: 'FAIL',
      evidence: { newChargers: snapshot, abnormal },
      message: `신규 ${snapshot.length}기 전부 비정상`
    };
  }
  if (stationStatus) {
    result.evidence.stationStatus = stationStatus;
    if (stationStatus !== '운영') {
      result.status = result.status === 'FAIL' ? 'FAIL' : 'WARN';
      result.message += ` · 충전소 상태=${stationStatus} — operateStation(STATIONS_TOPIC) 동반전이 확인 필요`;
    }
  }
  return result;
}

/**
 * 체커 시그니처: (station, ctx) → CheckResult
 * station은 audit.js의 enrichment 단계에서 `newChargers`(+`stationStatus`)가 채워져 있어야 함.
 */
export async function checkStatus(station, _ctx) {
  return judgeStatus(station.newChargers || [], station.stationStatus ?? null);
}
