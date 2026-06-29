const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';

// 영차영차new 시트는 첫 몇 행이 컬럼 번호/메타 행이고 헤더("주소")는 4번째 행쯤.
// 데이터가 5번째 행 이후 산발적으로 시작. 컬럼 인덱스로 직접 접근하는 게 가장 robust.
const ADDRESS_COL_INDEX = 5;   // F열 (0-based)
const INIT_DATE_COL = 68;      // BQ열(서비스개시일) — 원본시트 BR→BQ 이동(2026-06): B=2,Q=17 → 2*26+17=69 → 0-based 68
const PROJECT_URL_COL_INDEX = 0; // A열: /manage/projects/{id}/construction URL
const PROJECT_NAME_COL_INDEX = 4; // E열: 프로젝트명 (예: "25년환경부_현대2차아파트_1차")

/** 시트 행의 A열 URL에서 projectId 추출 */
function rowProjectId(row) {
  return (row[PROJECT_URL_COL_INDEX] || '').match(/projects\/(\d+)/)?.[1] || null;
}

/**
 * gviz CSV → 배열의 배열 (헤더 변환 없음). 각 row는 셀 배열.
 */
export function parseGvizCsv(text) {
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

// 시도 풀네임 → 약자 정규화 (시트는 보통 약자, 플링커넥트는 풀네임 "세종특별자치시" 등)
const SIDO_FULL_TO_SHORT = [
  ['서울특별시', '서울'], ['부산광역시', '부산'], ['대구광역시', '대구'],
  ['인천광역시', '인천'], ['광주광역시', '광주'], ['대전광역시', '대전'],
  ['울산광역시', '울산'], ['세종특별자치시', '세종'],
  ['경기도', '경기'], ['강원특별자치도', '강원'], ['강원도', '강원'],
  ['충청북도', '충북'], ['충청남도', '충남'],
  ['전북특별자치도', '전북'], ['전라북도', '전북'],
  ['전라남도', '전남'], ['경상북도', '경북'], ['경상남도', '경남'],
  ['제주특별자치도', '제주'], ['제주도', '제주']
];

function normalizeAddress(s) {
  let v = (s || '').replace(/\s+/g, ' ').trim();
  for (const [full, short] of SIDO_FULL_TO_SHORT) {
    if (v.startsWith(full + ' ') || v === full) {
      v = short + v.slice(full.length);
      break;
    }
  }
  return v;
}

/**
 * F열(=5) 주소로 매칭, 서비스개시일(BQ=68) 비교.
 * @param {Array<Array<string>>} rows
 * @param {string} stationAddress
 * @param {string} pluglinkInitDate
 */
export function judgeSheet(rows, stationAddress, pluglinkInitDate, projectIds = []) {
  const target = normalizeAddress(stationAddress);
  if (!target) {
    return {
      status: 'SKIP',
      evidence: { matchedRow: null, brValue: null, pluglinkInitDate, mismatchKind: 'NO_ADDRESS' },
      message: '플링커넥트 주소 없음 — 매칭 불가'
    };
  }

  // 주소 매칭 후보 인덱스 수집 (정확 일치 → 없으면 부분 일치)
  let candidateIdxs = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => normalizeAddress(r[ADDRESS_COL_INDEX]) === target)
    .map(({ i }) => i);
  let matchKind = 'EXACT';
  if (candidateIdxs.length === 0) {
    candidateIdxs = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        const a = normalizeAddress(r[ADDRESS_COL_INDEX]);
        return a && (a.includes(target) || target.includes(a));
      })
      .map(({ i }) => i);
    matchKind = 'PARTIAL';
  }
  if (candidateIdxs.length === 0) {
    return {
      status: 'SKIP',
      evidence: { matchedRow: null, brValue: null, pluglinkInitDate, mismatchKind: 'ROW_NOT_FOUND' },
      message: `시트에서 주소 "${target}" 행을 찾지 못함`
    };
  }

  // 같은 주소 여러 프로젝트일 수 있음. 우선순위:
  //   1) 시트 projectId가 충전소 projectIds에 포함된 행 (가장 정확)
  //   2) BR == 오늘 인 행
  //   3) BR이 가장 최신인 행
  //   4) 첫 후보
  const pidSet = new Set((projectIds || []).map(String));
  const br_ = (i) => (rows[i][INIT_DATE_COL] || '').trim();
  // projectId 매칭 후보가 여러 개일 수 있음(과거+현재 프로젝트 모두 충전소에 연결).
  // 그 안에서 BR==오늘 → BR 최신 순으로 좁힌다. projectId 매칭이 없으면 전체 후보로.
  const pidMatches = candidateIdxs.filter(i => pidSet.has(rowProjectId(rows[i])));
  const pool = pidMatches.length ? pidMatches : candidateIdxs;
  const pickByBr = (idxs) =>
    idxs.find(i => br_(i) === pluglinkInitDate) ??
    [...idxs].filter(i => br_(i)).sort((a, b) => br_(b).localeCompare(br_(a)))[0] ??
    idxs[0];
  let rowIdx = pickByBr(pool);
  if (rowIdx === undefined) rowIdx = candidateIdxs[0];
  const matchedByProjectId = pidSet.has(rowProjectId(rows[rowIdx]));

  const row = rows[rowIdx];
  const br = (row[INIT_DATE_COL] || '').trim();
  const evidenceBase = {
    matchedRow: row[ADDRESS_COL_INDEX],
    sheetRowNumber: rowIdx + 1,
    matchKind,
    matchedByProjectId,
    candidateCount: candidateIdxs.length,
    sheetProjectId: rowProjectId(row),
    projectName: (row[PROJECT_NAME_COL_INDEX] || '').trim() || null,
    brValue: br || null,
    pluglinkInitDate
  };
  if (!br) {
    return {
      status: 'FAIL',
      evidence: { ...evidenceBase, mismatchKind: 'MISSING' },
      message: '영차영차 개시일(BQ) 비어있음'
    };
  }
  if (br === pluglinkInitDate) {
    return {
      status: 'PASS',
      evidence: { ...evidenceBase, mismatchKind: null },
      message: `개시일 ${br} 일치 (${matchKind}, row ${rowIdx + 1})`
    };
  }
  return {
    status: 'FAIL',
    evidence: { ...evidenceBase, mismatchKind: 'DATE_MISMATCH' },
    message: `개시일(${br}) ≠ 플링커넥트(${pluglinkInitDate})`
  };
}

/** 영차영차new 시트 1회 로드 (rows). [HM] projectId 판정 등 재사용용. */
export async function loadYeongchaRows(fetchSheetCsv) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  return parseGvizCsv(await fetchSheetCsv(url));
}

/**
 * projectId 기준으로 시트에서 프로젝트명(E열) 조회 — 주소 매칭에 의존하지 않아 견고.
 * 충전소는 여러 projectId(과거+현재)를 가질 수 있어, "오늘 개시하는 프로젝트"(BR==today) 행을 우선.
 * 그 풀에서 [HM] 행이 있으면 그 이름을 반환(=오늘 [HM]로 개시 → 제외 판정에 사용).
 * @param {Array<Array<string>>} rows
 * @param {string[]} projectIds
 * @param {string} today 'YYYY-MM-DD'
 * @returns {string|null}
 */
export function findProjectNameByProjectIds(rows, projectIds, today) {
  const pidSet = new Set((projectIds || []).map(String));
  if (pidSet.size === 0) return null;
  const matched = rows.filter(r => pidSet.has(rowProjectId(r)));
  if (matched.length === 0) return null;
  const br = r => (r[INIT_DATE_COL] || '').trim();
  const name = r => (r[PROJECT_NAME_COL_INDEX] || '').trim() || null;
  // 현재 개시 프로젝트 선택: BR==today 우선 → 그 외 BR 최신 → BR 없으면 첫 행.
  //   개시일(BQ)이 있는 행이 실제 개시한 프로젝트. [HM] 1차는 보통 개시일이 비어있고,
  //   같은 충전소가 환경부 2차로 재개시되면 그 행에 BR이 있어 비-HM으로 올바르게 잡힌다.
  //   [HM] 우선 편향을 두지 않아, 현재 환경부 프로젝트가 있으면 제외하지 않는다.
  const todayRows = matched.filter(r => br(r) === today);
  const pool = todayRows.length ? todayRows : matched;
  const byBr = [...pool].filter(r => br(r)).sort((a, b) => br(b).localeCompare(br(a)))[0];
  return name(byBr || pool[0]);
}

export async function checkSheet(station, ctx) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
    const csv = await ctx.fetchSheetCsv(url);
    const rows = parseGvizCsv(csv);
    return judgeSheet(rows, station.address, station.initiatedAt, station.projectIds);
  } catch (e) {
    const msg = (e?.message ?? String(e)).slice(0, 100);
    return { status: 'SKIP', evidence: { error: msg }, message: `시트 fetch 실패: ${msg}` };
  }
}
