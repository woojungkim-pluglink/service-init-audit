/**
 * 요금제 검증 — Phase 2 미구현 (placeholder).
 *
 * 충전소 페이지의 충전기 리스트에서 각 충전기의 "적용중인 요금제"가 수집됨 (enrich_station).
 * Phase 2에서 추가할 것:
 *  - station.projectIds 각각에 대해 프로젝트 계약탭 → 합의 요금제명 + 특가합의서 첨부 fetch
 *  - 충전기들의 적용중 요금제와 합의 요금제 일치 여부 + 특가 시 합의서 존재 검증
 */
export async function checkRate(station, _ctx) {
  const appliedRates = [...new Set((station.newChargers || []).map(c => c.appliedRate).filter(Boolean))];
  if (appliedRates.length === 0) {
    return {
      status: 'SKIP',
      evidence: { appliedRates: [], note: 'Phase 2 미구현 — 계약탭 비교 없음' },
      message: '요금제 검증은 Phase 2에서 구현 예정 (계약탭 비교)'
    };
  }
  if (appliedRates.length === 1) {
    return {
      status: 'SKIP',
      evidence: { appliedRates, note: 'Phase 2 미구현 — 계약탭 비교 없음' },
      message: `신규 충전기 적용 요금제: ${appliedRates[0]} (계약탭 비교는 Phase 2)`
    };
  }
  return {
    status: 'WARN',
    evidence: { appliedRates, note: 'Phase 2 미구현 — 계약탭 비교 없음' },
    message: `신규 충전기에 서로 다른 요금제 ${appliedRates.length}종 적용 — 의도 확인 필요`
  };
}
