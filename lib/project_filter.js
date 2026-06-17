// 환경부 서비스개시 검증 대상이 아닌 파트너(한화 등) 프로젝트 태그.
//   영차영차new 프로젝트명(E열) 앞에 붙는 대괄호 태그로 구분된다.
//   [HM]·[EP] = 한화 현장(한화모티브 요금) → 우리 알림 대상 아님.
const EXCLUDED_TAGS = ['HM', 'EP'];
const EXCLUDED_RE = new RegExp(`\\[\\s*(?:${EXCLUDED_TAGS.join('|')})\\s*\\]`, 'i');

/**
 * 서비스개시 알림 대상 제외 판정.
 * 프로젝트명에 파트너 태그([HM]/[EP] 등)가 있으면 우리(환경부) 알림 대상이 아니므로 제외.
 * @param {string|null|undefined} projectName
 * @returns {boolean} true면 알림에서 제외
 */
export function isExcludedProject(projectName) {
  return EXCLUDED_RE.test(projectName || '');
}
