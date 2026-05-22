/**
 * today (YYYY-MM-DD)에서 days만큼 뺀 날짜를 YYYY-MM-DD로 반환.
 * Timezone-safe: 모든 환경에서 동일 결과.
 */
export function calcCutoff(today, days) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}
