const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';
const PROJECT_ID_COL = '프로젝트ID';        // Task 14에서 실제 컬럼명 확정 가능
const BR_COL = 'BR(서비스개시일)';

export function parseGvizCsv(text) {
  const lines = text.trim().split('\n');
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

export function judgeSheet(rows, projectId, pluglinkInitDate) {
  const row = rows.find(r => r[PROJECT_ID_COL] === projectId);
  if (!row) {
    return {
      status: 'SKIP',
      evidence: { rowNumber: null, brValue: null, pluglinkInitDate, mismatchKind: 'ROW_NOT_FOUND' },
      message: `시트에서 프로젝트ID ${projectId} 행을 찾지 못함`
    };
  }
  const br = (row[BR_COL] || '').trim();
  const rowNumber = parseInt(row['행'], 10) || null;
  if (!br) {
    return {
      status: 'FAIL',
      evidence: { rowNumber, brValue: null, pluglinkInitDate, mismatchKind: 'MISSING' },
      message: '영차영차 BR열 비어있음'
    };
  }
  if (br === pluglinkInitDate) {
    return {
      status: 'PASS',
      evidence: { rowNumber, brValue: br, pluglinkInitDate, mismatchKind: null },
      message: `BR열 ${br} 일치`
    };
  }
  return {
    status: 'FAIL',
    evidence: { rowNumber, brValue: br, pluglinkInitDate, mismatchKind: 'DATE_MISMATCH' },
    message: `BR열(${br}) ≠ 플링커넥트(${pluglinkInitDate})`
  };
}

export async function checkSheet(project, ctx) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
    const csv = await ctx.fetchSheetCsv(url);
    const rows = parseGvizCsv(csv);
    return judgeSheet(rows, project.projectId, project.initiatedAt);
  } catch (e) {
    const msg = (e?.message ?? String(e)).slice(0, 100);
    return { status: 'SKIP', evidence: { error: msg }, message: `시트 fetch 실패: ${msg}` };
  }
}
