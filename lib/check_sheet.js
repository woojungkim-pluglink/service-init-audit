const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';
const ADDRESS_COL = '주소';                    // F열 (사용자 명시: 유일한 매칭 헤더)
const BR_COL = '서비스개시일';                 // BR열 — 헤더명 추정. Task 17에서 실데이터로 확정 가능

export function parseGvizCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
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
 * @param {Array<Object>} rows
 * @param {string} stationAddress
 * @param {string} pluglinkInitDate
 */
export function judgeSheet(rows, stationAddress, pluglinkInitDate) {
  const target = normalizeAddress(stationAddress);
  if (!target) {
    return {
      status: 'SKIP',
      evidence: { matchedRow: null, brValue: null, pluglinkInitDate, mismatchKind: 'NO_ADDRESS' },
      message: '플링커넥트 주소 없음 — 매칭 불가'
    };
  }
  let row = rows.find(r => normalizeAddress(r[ADDRESS_COL]) === target);
  let matchKind = 'EXACT';
  if (!row) {
    row = rows.find(r => {
      const a = normalizeAddress(r[ADDRESS_COL]);
      return a && (a.includes(target) || target.includes(a));
    });
    matchKind = 'PARTIAL';
  }
  if (!row) {
    return {
      status: 'SKIP',
      evidence: { matchedRow: null, brValue: null, pluglinkInitDate, mismatchKind: 'ROW_NOT_FOUND' },
      message: `시트에서 주소 "${target}" 행을 찾지 못함`
    };
  }
  const br = (row[BR_COL] || '').trim();
  const evidenceBase = {
    matchedRow: row[ADDRESS_COL],
    matchKind,
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
      message: `BR ${br} 일치 (${matchKind})`
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
    return judgeSheet(rows, station.address, station.initiatedAt);
  } catch (e) {
    const msg = (e?.message ?? String(e)).slice(0, 100);
    return { status: 'SKIP', evidence: { error: msg }, message: `시트 fetch 실패: ${msg}` };
  }
}
