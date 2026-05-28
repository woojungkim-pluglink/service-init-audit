/**
 * 요금제 검증 — 영업관리 스프레드시트의 계약 요금제와 충전기 적용 요금제 비교.
 *
 * 시트: docs.google.com/spreadsheets/d/10arITgn0Eaa6nUchz3nza6w9ixkOzQC88j49QYvGwxU (gid=1445153433)
 *   - B (1):  프로젝트ID
 *   - AY(50): 기본요금 (예: "공동주택 고압", "상업시설 고압")
 *   - AZ(51): 특약요금제 (예: "공동주택 특가요금(149원)", "단기계약(220원)", "미적용", 또는 빈)
 *   - BA(52): 특약요금제 기간 (예: 365, 9999, 0)
 */

const RATE_SHEET_ID = '10arITgn0Eaa6nUchz3nza6w9ixkOzQC88j49QYvGwxU';
const RATE_GID = '1445153433';
const PROJECT_ID_COL = 1;       // B
const BASIC_RATE_COL = 50;      // AY
const SPECIAL_RATE_COL = 51;    // AZ
const SPECIAL_PERIOD_COL = 52;  // BA

/** "특가요금 (149원)" / "공동주택 특가요금(149원)" → "149" */
export function extractPrice(s) {
  return (s || '').match(/(\d+(?:\.\d+)?)\s*원/)?.[1] || null;
}

/** 기본요금 계열인지 (특약 아님): "공시요금", "기본요금", "고압", "저압" 텍스트 포함 + 특가 아님 */
function isBasicRateText(s) {
  if (!s) return false;
  if (/특가|특약|단기/.test(s)) return false;
  return /공시요금|기본요금|고압|저압/.test(s);
}

/** 계약 합의 요금제 추출 — 시트 행 1개에서 */
function extractContract(row) {
  const basic = (row[BASIC_RATE_COL] || '').trim();
  const special = (row[SPECIAL_RATE_COL] || '').trim();
  const period = (row[SPECIAL_PERIOD_COL] || '').trim();
  const hasSpecial = !!special && special !== '미적용';
  return {
    projectId: (row[PROJECT_ID_COL] || '').trim(),
    basicRate: basic,
    specialRate: special,
    specialPeriod: period,
    hasSpecial,
    expectedPrice: hasSpecial ? extractPrice(special) : null
  };
}

/**
 * 충전기 적용 요금제가 계약 후보 중 하나와 일치하는지.
 * - 특약 계약: 가격 일치
 * - 기본 계약: 충전기가 기본요금 계열 (공시요금/고압 등)
 */
function matchesAnyContract(chargerRate, contracts) {
  if (!chargerRate) return false;
  const chargerPrice = extractPrice(chargerRate);
  return contracts.some(c => {
    if (c.hasSpecial) {
      return c.expectedPrice && chargerPrice === c.expectedPrice;
    }
    return isBasicRateText(chargerRate);
  });
}

/**
 * 순수 판정 함수 (테스트 대상).
 * @param {object} station — { projectIds, newChargers }
 * @param {Array<Array<string>>} rows — 시트 raw rows
 */
export function judgeRate(station, rows) {
  const pidSet = new Set((station.projectIds || []).map(String));
  if (pidSet.size === 0) {
    return { status: 'SKIP', evidence: { reason: 'NO_PROJECT_IDS' }, message: '프로젝트ID 없음 — 매칭 불가' };
  }

  const matchedRows = rows.filter(r => pidSet.has(String(r[PROJECT_ID_COL] || '').trim()));
  if (matchedRows.length === 0) {
    return {
      status: 'SKIP',
      evidence: { reason: 'ROW_NOT_FOUND', projectIds: [...pidSet] },
      message: `요금제 시트에서 프로젝트번호 [${[...pidSet].join(', ')}] 행 못 찾음`
    };
  }

  const contracts = matchedRows.map(extractContract);
  const appliedRates = [...new Set((station.newChargers || []).map(c => c.appliedRate).filter(Boolean))];
  if (appliedRates.length === 0) {
    return {
      status: 'SKIP',
      evidence: { contracts, appliedRates: [] },
      message: '신규 충전기 적용 요금제 정보 없음'
    };
  }

  const perRate = appliedRates.map(r => ({
    rate: r,
    price: extractPrice(r),
    matched: matchesAnyContract(r, contracts)
  }));
  const allMatched = perRate.every(p => p.matched);
  const evidence = { contracts, appliedRates: perRate };

  if (allMatched) {
    return {
      status: 'PASS',
      evidence,
      message: `${appliedRates.length}종 요금제 모두 계약 일치`
    };
  }
  const failedRates = perRate.filter(p => !p.matched).map(p => p.rate);
  return {
    status: 'FAIL',
    evidence,
    message: `계약 불일치: ${failedRates.join(', ')}`
  };
}

/** 체커 시그니처 */
export async function checkRate(station, ctx) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${RATE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${RATE_GID}`;
    const csv = await ctx.fetchSheetCsv(url);
    const rows = parseCsv(csv);
    return judgeRate(station, rows);
  } catch (e) {
    const msg = (e?.message ?? String(e)).slice(0, 100);
    return { status: 'SKIP', evidence: { error: msg }, message: `요금제 시트 fetch 실패: ${msg}` };
  }
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
