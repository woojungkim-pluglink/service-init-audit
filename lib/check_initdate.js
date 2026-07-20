/**
 * 서비스개시일자 검증 — 플링커넥트 충전기 테이블의 맨 우측 열('서비스 개시일')을 충전기별로 점검.
 * 명확한 오류만 WARN으로 잡는다(기축 충전기 오탐 방지를 위해 '오늘과 다른 과거 날짜'는 대상 아님):
 *   - 공란: 개시일 미기재
 *   - 형식오류: YYYY-MM-DD 형식이 아님
 *   - 미래날짜: 개시일이 실행일(today)보다 미래 — 논리적으로 불가
 *
 * 순수 함수(I/O 없음) — station.chargers는 enrich_station.fetchStationData가 채운다.
 *   charger.initiatedAt = '서비스 개시일' 컬럼 값(공란이면 빈 문자열).
 * @param {object} station
 * @param {string} [today] 실행일 'YYYY-MM-DD' (미래날짜 판정용; 없으면 미래 검사 생략)
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function judgeInitDate(station, today) {
  const chargers = station?.chargers || [];
  if (chargers.length === 0) {
    return { status: 'SKIP', evidence: { reason: 'NO_CHARGERS' }, message: '충전기 목록 없음' };
  }
  const blank = [], invalid = [], future = [];
  for (const c of chargers) {
    const v = String(c.initiatedAt || '').trim();
    if (!v) { blank.push(c.chargerId); continue; }
    if (!ISO_DATE.test(v)) { invalid.push(c.chargerId); continue; }
    if (today && v > today) { future.push(c.chargerId); continue; }
  }
  const badCount = blank.length + invalid.length + future.length;
  const evidence = {
    total: chargers.length, blank: blank.length, invalid: invalid.length, future: future.length,
    blankChargers: blank, invalidChargers: invalid, futureChargers: future
  };
  if (badCount === 0) {
    return { status: 'PASS', evidence, message: `서비스개시일자 정상 (${chargers.length}기)` };
  }
  const parts = [];
  if (blank.length) parts.push(`공란 ${blank.length}기(${blank.join(', ')})`);
  if (invalid.length) parts.push(`형식오류 ${invalid.length}기(${invalid.join(', ')})`);
  if (future.length) parts.push(`미래날짜 ${future.length}기(${future.join(', ')})`);
  return {
    status: 'WARN',
    evidence,
    message: `서비스개시일자 이상 ${badCount}/${chargers.length}기 — ${parts.join('; ')}`
  };
}
