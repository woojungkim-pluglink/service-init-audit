/**
 * 다음 개시 예정 충전소 발견 — 영차영차new 시트의 개시일(BQ)=대상일 행.
 * 대상일: 평일이면 내일 하루. 주말엔 자동 실행이 없으므로 내일이 주말이면
 *   그 주말 + 다음 영업일(월)까지 한 번에 커버 (nextTargetDates 참고).
 *
 * 시트: docs.google.com/spreadsheets/d/18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI (gid=300841532)
 *   - A(0): 프로젝트 URL (/manage/projects/{projectId}/construction)
 *   - F(5): 주소
 *   - BQ(68): 서비스개시일 (원본시트 BR→BQ 이동, 2026-06)
 */

import { isExcludedProject } from './project_filter.js';

const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';
const PROJECT_URL_COL = 0;
const PROJECT_NAME_COL = 4;  // E열
const ADDRESS_COL = 5;
const INIT_DATE_COL = 68;  // BQ열(서비스개시일) — 원본시트 BR→BQ 이동(2026-06)

/** 시트 행 → projectId 추출 (A열 URL에서) */
function rowProjectId(row) {
  return (row[PROJECT_URL_COL] || '').match(/projects\/(\d+)/)?.[1] || null;
}

/** today 다음날(YYYY-MM-DD). today는 'YYYY-MM-DD' */
export function nextDay(today) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'의 요일 (0=일 … 6=토) */
function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 다음 실행이 커버해야 할 개시 예정일 목록.
 * 평일이면 내일 1개. 단, 주말엔 자동 실행이 없으므로 내일이 주말이면
 * 그 주말 + 다음 영업일(월)까지 한 번에 커버한다.
 *   금요일 실행(내일=토) → [토, 일, 월]
 *   토요일 실행(내일=일) → [일, 월]
 *   평일 실행            → [내일]
 * @param {string} today 'YYYY-MM-DD'
 * @returns {string[]} 'YYYY-MM-DD' 오름차순
 */
export function nextTargetDates(today) {
  const dates = [nextDay(today)];
  // 마지막 날이 토(6)/일(0)이면 다음 날을 계속 추가 — 첫 평일에서 멈춤
  while ([0, 6].includes(dayOfWeek(dates[dates.length - 1]))) {
    dates.push(nextDay(dates[dates.length - 1]));
  }
  return dates;
}

/**
 * 시트 rows 중 BR ∈ 대상일(nextTargetDates) 인 행들을 station-like 객체로 추출.
 * 각 행은 자기 BR 값을 initiatedAt 으로 가진다 (여러 날짜가 섞일 수 있음).
 * @param {Array<Array<string>>} rows
 * @param {string} today 'YYYY-MM-DD'
 * @returns {Array<{ projectId, address, projectName, initiatedAt }>}
 */
export function pickTomorrowRows(rows, today) {
  const targets = new Set(nextTargetDates(today));
  const out = [];
  for (const r of rows) {
    const br = (r[INIT_DATE_COL] || '').trim();
    if (!targets.has(br)) continue;
    const projectId = rowProjectId(r);
    const address = (r[ADDRESS_COL] || '').trim();
    const projectName = (r[PROJECT_NAME_COL] || '').trim() || null;
    if (!projectId) continue;
    // [HM] 프로젝트는 우리 알림 대상 아님 — 제외
    if (isExcludedProject(projectName)) continue;
    out.push({ projectId, address, projectName, initiatedAt: br });
  }
  // 날짜 → projectId 순 정렬 (출력 그룹핑 편의)
  out.sort((a, b) => a.initiatedAt.localeCompare(b.initiatedAt) || a.projectId.localeCompare(b.projectId));
  return out;
}

/**
 * fetchSheetCsv로 시트 fetch + 내일 행 추출.
 * @param {(url: string) => Promise<string>} fetchSheetCsv
 * @param {string} today
 */
export async function discoverTomorrowStations(fetchSheetCsv, today) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  const csv = await fetchSheetCsv(url);
  const rows = parseCsv(csv);
  return pickTomorrowRows(rows, today);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  return lines.map(parseCsvLine);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
