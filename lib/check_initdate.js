/**
 * 서비스개시일자 기재 검증 — 플링커넥트 충전기 테이블의 맨 우측 열('서비스 개시일')이
 * 공란인 충전기가 있는지 확인한다. 개시된 충전소인데 개시일자가 비어 있으면 데이터 누락 신호.
 *
 * 순수 함수(I/O 없음) — station.chargers는 enrich_station.fetchStationData가 채운다.
 *   charger.initiatedAt = '서비스 개시일' 컬럼 값(공란이면 빈 문자열).
 */
export function judgeInitDate(station) {
  const chargers = station?.chargers || [];
  if (chargers.length === 0) {
    return { status: 'SKIP', evidence: { reason: 'NO_CHARGERS' }, message: '충전기 목록 없음' };
  }
  const blanks = chargers.filter(c => !String(c.initiatedAt || '').trim());
  if (blanks.length === 0) {
    return {
      status: 'PASS',
      evidence: { total: chargers.length, blank: 0 },
      message: `서비스개시일자 전건 기재 (${chargers.length}기)`
    };
  }
  const ids = blanks.map(c => c.chargerId).filter(Boolean);
  return {
    status: 'WARN',
    evidence: { total: chargers.length, blank: blanks.length, blankChargers: ids },
    message: `서비스개시일자 공란 ${blanks.length}/${chargers.length}기: ${ids.join(', ')}`
  };
}
