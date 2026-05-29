/**
 * 서비스개시 알림 대상 제외 판정.
 * 영차영차new 프로젝트명(E열)에 [HM] 태그가 기재된 프로젝트는 우리 알림 대상이 아니므로 제외한다.
 * @param {string|null|undefined} projectName
 * @returns {boolean} true면 알림에서 제외
 */
export function isExcludedProject(projectName) {
  return /\[\s*HM\s*\]/i.test(projectName || '');
}
