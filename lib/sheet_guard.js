// 시트 컬럼 이동(장애 5·7 재발) 조기 감지 가드.
//   하드코딩된 컬럼 인덱스에 기대한 '데이터 모양'이 맞는지 값의 형태로 검사한다.
//   헤더 라벨 리네임에도 견고하도록 라벨이 아닌 값(날짜/주소 채움률)으로 판정.
//   컬럼이 밀리면 개시일 컬럼은 날짜가 아닌 값(요금명 등)이 들어와 비율이 붕괴 → 감지.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// check_sheet.js와 동일한 인덱스 (영차영차new)
const PROJECT_URL_COL = 0;
const ADDRESS_COL = 5;    // F
const INIT_DATE_COL = 68; // BQ (서비스개시일)

/** A열 URL에서 projectId 추출 (데이터 행 판별용) */
export function rowProjectId(row) {
  return (row?.[PROJECT_URL_COL] || '').match(/projects\/(\d+)/)?.[1] || null;
}

/**
 * 영차영차new rows의 컬럼 형태 sanity 검사 (순수, 테스트 대상).
 * - 개시일(BQ=68): 비어있지 않은 값 중 ISO 날짜 비율 ≥ dateRatioMin, 날짜 셀 ≥ minDates
 * - 주소(F=5): 데이터 행 중 채움 비율 ≥ addrRatioMin
 * 둘 중 하나라도 무너지면 컬럼 이동 의심.
 * @returns {{ok:boolean, reason:string|null, stats:object}}
 */
export function checkYeongchaShape(rows, opts = {}) {
  const minDates = opts.minDates ?? 20;
  const dateRatioMin = opts.dateRatioMin ?? 0.8;
  const addrRatioMin = opts.addrRatioMin ?? 0.8;

  const dataRows = (rows || []).filter(r => rowProjectId(r));
  if (dataRows.length < minDates) {
    return {
      ok: false,
      reason: `데이터 행(${dataRows.length})이 너무 적음 — 시트 로드 실패/구조 변경 의심`,
      stats: { dataRows: dataRows.length }
    };
  }
  const dateCells = dataRows.map(r => (r[INIT_DATE_COL] || '').trim()).filter(Boolean);
  const dateHits = dateCells.filter(v => ISO_DATE.test(v)).length;
  const dateRatio = dateCells.length ? dateHits / dateCells.length : 0;
  const addrFilled = dataRows.filter(r => (r[ADDRESS_COL] || '').trim()).length / dataRows.length;

  const ok = dateHits >= minDates && dateRatio >= dateRatioMin && addrFilled >= addrRatioMin;
  const reason = ok ? null
    : `개시일(BQ=${INIT_DATE_COL}) 날짜비율 ${(dateRatio * 100).toFixed(0)}%·${dateHits}건 / 주소(F=${ADDRESS_COL}) 채움 ${(addrFilled * 100).toFixed(0)}% — 컬럼 이동 의심`;
  return {
    ok, reason,
    stats: { dataRows: dataRows.length, dateCells: dateCells.length, dateHits, dateRatio: +dateRatio.toFixed(3), addrFilled: +addrFilled.toFixed(3) }
  };
}
