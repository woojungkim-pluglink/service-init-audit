/**
 * Task 14에서 사용: 실제 플링커넥트 페이지를 열어 셀렉터를 확인하는 헬퍼.
 *
 * 실행:
 *   node scripts/inspect_plinkconnect.js --projectId=<id> --stationId=<id>
 *
 * 동작:
 *   1. chrome_profile/ 세션으로 헤드풀(브라우저 가시화) 실행
 *   2. 프로젝트 계약탭 → 30초 대기 (DevTools로 셀렉터 확인)
 *   3. 프로젝트 서비스개시 탭 → 30초 대기
 *   4. 충전소 페이지(요금제탭 포함) → 30초 대기
 *   5. 종료
 *
 * 확인할 셀렉터:
 *   - 프로젝트 계약탭: 합의 요금제명, 첨부파일 영역
 *   - 충전소 요금제탭: 요금제별 자세히 버튼 → 적용 충전기 리스트
 *   - 프로젝트 서비스개시 탭: 등록 충전기 리스트
 *   - 충전소 페이지 하단: 충전기 상태 테이블 (사업개시/운영/사용가능)
 */
import { openSession, closeSession } from '../lib/playwright_session.js';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (!a.startsWith('--')) return null;
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }).filter(Boolean)
);

const projectId = args.projectId;
const stationId = args.stationId;
if (!projectId || !stationId) {
  console.error('사용법: node scripts/inspect_plinkconnect.js --projectId=<id> --stationId=<id>');
  process.exit(1);
}

const ctx = await openSession({ profileDir: './chrome_profile', headless: false });
const page = await ctx.newPage();

console.log('\n[1/3] 프로젝트 계약탭 — 30초 대기 (DevTools로 rate-name, attachments 셀렉터 확인)');
await page.goto(`https://connect.pluglink.kr/projects/${projectId}?tab=contract`);
await page.waitForTimeout(30000);

console.log('\n[2/3] 프로젝트 서비스개시 탭 — 30초 대기 (충전기 리스트 셀렉터 확인)');
await page.goto(`https://connect.pluglink.kr/projects/${projectId}?tab=init`);
await page.waitForTimeout(30000);

console.log('\n[3/3] 충전소 페이지 — 30초 대기 (하단 충전기 상태 테이블 + 요금제탭 자세히 셀렉터 확인)');
await page.goto(`https://connect.pluglink.kr/stations/${stationId}`);
await page.waitForTimeout(30000);

await closeSession();
console.log('\n완료. 확인한 셀렉터를 lib/check_rate.js, lib/check_status.js 의 [data-test="..."] 부분에 반영하세요.');
