const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';

// 영차영차new 시트는 첫 몇 행이 컬럼 번호/메타 행이고 헤더("주소")는 4번째 행쯤.
// 데이터가 5번째 행 이후 산발적으로 시작. 컬럼 인덱스로 직접 접근하는 게 가장 robust.
const ADDRESS_COL_INDEX = 5;   // F열 (0-based)
const BR_COL_INDEX = 69;       // BR열 (B=2, R=18 → 2*26 + 18 = 70 → 0-based 69)
const PROJECT_URL_COL_INDEX = 0; // A열: /manage/projects/{id}/construction URL

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

function normalizeAddress(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * F열(=5) 주소로 매칭, BR열(=69) 서비스개시일 비교.
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
  const br_ = (i) => (rows[i][BR_COL_INDEX] || '').trim();
  let rowIdx =
    candidateIdxs.find(i => pidSet.has(rowProjectId(rows[i]))) ??
    candidateIdxs.find(i => br_(i) === pluglinkInitDate) ??
    [...candidateIdxs].filter(i => br_(i)).sort((a, b) => br_(b).localeCompare(br_(a)))[0] ??
    candidateIdxs[0];
  if (rowIdx === undefined) rowIdx = candidateIdxs[0];
  const matchedByProjectId = pidSet.has(rowProjectId(rows[rowIdx]));

  const row = rows[rowIdx];
  const br = (row[BR_COL_INDEX] || '').trim();
  const evidenceBase = {
    matchedRow: row[ADDRESS_COL_INDEX],
    sheetRowNumber: rowIdx + 1,
    matchKind,
    matchedByProjectId,
    candidateCount: candidateIdxs.length,
    sheetProjectId: rowProjectId(row),
    brValue: br || null,
    pluglinkInitDate
  };
  if (!br) {
    return {
      status: 'FAIL',
      evidence: { ...evidenceBase, mismatchKind: 'MISSING' },
      message: '영차영차 BR(서비스개시일) 비어있음'
    };
  }
  if (br === pluglinkInitDate) {
    return {
      status: 'PASS',
      evidence: { ...evidenceBase, mismatchKind: null },
      message: `BR ${br} 일치 (${matchKind}, row ${rowIdx + 1})`
    };
  }
  return {
    status: 'FAIL',
    evidence: { ...evidenceBase, mismatchKind: 'DATE_MISMATCH' },
    message: `BR(${br}) ≠ 플링커넥트(${pluglinkInitDate})`
  };
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
