/**
 * 통신미연결 충전기 탐지 — 개시된 충전소의 충전기 중 커넥터 상태가 '통신미연결'인 것이 있으면 WARN.
 *
 * 순수 함수(I/O 없음) — station.chargers는 enrich_station.fetchStationData가 채운다.
 *   charger.connectorStatus = '커넥터 상태' 컬럼 값(예: 사용가능/충전중/통신미연결/사용불가 등).
 *   (status 체크는 오늘 개시분만 보지만, 이 체크는 충전소 전체 충전기의 통신미연결을 잡는다.)
 */
const DISCONNECTED = /통신\s*미연결/; // 표기 흔들림('통신 미연결') 흡수

export function isDisconnected(connectorStatus) {
  return DISCONNECTED.test(String(connectorStatus || ''));
}

export function judgeCommStatus(station) {
  const chargers = station?.chargers || [];
  if (chargers.length === 0) {
    return { status: 'SKIP', evidence: { reason: 'NO_CHARGERS' }, message: '충전기 목록 없음' };
  }
  const bad = chargers.filter(c => isDisconnected(c.connectorStatus));
  if (bad.length === 0) {
    return {
      status: 'PASS',
      evidence: { total: chargers.length, disconnected: 0 },
      message: `통신미연결 없음 (${chargers.length}기)`
    };
  }
  const ids = bad.map(c => c.chargerId).filter(Boolean);
  return {
    status: 'WARN',
    evidence: { total: chargers.length, disconnected: bad.length, disconnectedChargers: ids },
    message: `통신미연결 ${bad.length}/${chargers.length}기: ${ids.join(', ')}`
  };
}
