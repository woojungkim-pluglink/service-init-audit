/**
 * 요금제 검증 — 영업관리 스프레드시트의 계약 요금제와 충전기 적용 요금제 비교.
 *
 * 시트: docs.google.com/spreadsheets/d/10arITgn0Eaa6nUchz3nza6w9ixkOzQC88j49QYvGwxU (gid=1445153433)
 *   - B (1):  프로젝트ID
 *   - BD(55): 기본요금 (예: "공동주택 고압", "상업시설 고압")
 *   - BF(57): 특약요금제 (예: "공동주택 특가요금(149원)", "단기계약(220원)", "미적용", 또는 빈)
 *   - BG(58): 특약요금제 기간 (예: 365, 9999, 0)
 *   ※ 2026-06 시트 컬럼 이동: 기본요금 AY(50)→BD(55), 특약 AZ(51)→BF(57), 기간 BA(52)→BG(58).
 *     (동남/창포 행 대조로 확정. 잘못 읽으면 특약 오탐 FAIL 발생.)
 */

const RATE_SHEET_ID = '10arITgn0Eaa6nUchz3nza6w9ixkOzQC88j49QYvGwxU';
const RATE_GID = '1445153433';
const PROJECT_ID_COL = 1;       // B
const BASIC_RATE_COL = 55;      // BD
const SPECIAL_RATE_COL = 57;    // BF
const SPECIAL_PERIOD_COL = 58;  // BG

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

/**
 * 플링커넥트 계약탭(/manage/projects/{id}/contract) innerText에서 요금제 근거 추출 (순수).
 * 영업관리 시트 오기재를 거르기 위한 2차 확인용. 빨간 박스 3종:
 *   - 특약요금제 (예: "특가요금 (149원)")
 *   - 특약요금제 적용기간(일) (예: "365")
 *   - 합의서 첨부파일 (파일명에 "합의서" 포함 .pdf 존재 여부 — 슬롯이 "-"여도 타 영역 첨부 인정)
 */
export function extractContractTab(text) {
  // 업로드 파일명 한글이 분해형(NFD)인 경우가 있어(예: "요금합의서") NFC로 정규화 후 매칭
  const t = (text || '').normalize('NFC');
  const specialRate = t.match(/특약요금제\s*\n\s*([^\n]+?)\s*\n\s*특약요금제\s*적용기간/)?.[1]?.trim()
    || t.match(/특약요금제\s+(.+?)\s+특약요금제\s*적용기간/)?.[1]?.trim()
    || null;
  const specialPeriod = t.match(/특약요금제\s*적용기간\(일\)\s*\n?\s*(\d+)/)?.[1] ?? null;
  const generalRate = t.match(/일반요금제\s*\n\s*([^\n]+)/)?.[1]?.trim() || null;
  const hasAgreementFile = /합의서[^\n]*\.pdf/.test(t);
  return {
    specialRate,
    specialPrice: extractPrice(specialRate),
    specialPeriod,
    generalRate,
    hasAgreementFile
  };
}

/**
 * 시트 기준 FAIL을 플링커넥트 계약탭 근거로 재조정 (순수, 테스트 대상).
 * - 불일치 요금이 모두 계약탭 특약요금(적용기간>0)으로 설명되고 합의서 첨부 → PASS (시트 오기재 추정)
 * - 설명되나 합의서 미첨부 → WARN (요금은 맞으나 합의서 확인 필요)
 * - 그 외 → FAIL 유지
 */
export function reconcileWithContract(failResult, station, contractInfos) {
  const applied = failResult.evidence?.appliedRates || [];
  const failedRates = applied.filter(p => !p.matched);
  // 로드 실패(error/타임아웃)는 "특약 없음"으로 오판하지 않도록 제외
  const infos = (contractInfos || []).filter(c => c && !c.error && c.loaded !== false);
  const activePrices = new Set(
    infos.filter(c => c.specialPrice && Number(c.specialPeriod) > 0).map(c => c.specialPrice)
  );
  const anyAgreement = infos.some(c => c.hasAgreementFile);
  const evidence = { ...failResult.evidence, contractTab: contractInfos };

  const unexplained = failedRates.filter(p => !activePrices.has(p.price));
  if (activePrices.size === 0 || unexplained.length > 0) {
    return { status: 'FAIL', evidence, message: `${failResult.message} (계약탭에도 특약요금 불일치)` };
  }
  const priceLabel = [...activePrices].map(p => `${p}원`).join(',');
  if (!anyAgreement) {
    return {
      status: 'WARN',
      evidence: { ...evidence, reconciledBy: 'CONTRACT_TAB_NO_AGREEMENT' },
      message: `계약탭 특약요금(${priceLabel}) 일치하나 합의서 미첨부 — 확인 필요`
    };
  }
  return {
    status: 'PASS',
    evidence: { ...evidence, reconciledBy: 'CONTRACT_TAB' },
    message: `계약탭 확인 — 특약요금(${priceLabel}) 일치 + 합의서 첨부 (영업관리 시트 오기재 추정)`
  };
}

/**
 * 계약탭 innerText가 "계약 결과" 값까지 렌더 완료됐는지 (순수).
 * SPA라 라벨("특약요금제")은 먼저 떠도 값(일반요금제 공시요금 등)은 늦게 채워진다.
 * 일반요금제 값(원 포함)이 보이면 계약 결과 블록 로드 완료로 본다.
 */
export function isContractTabLoaded(info) {
  return Boolean(info && info.generalRate && /원/.test(info.generalRate));
}

/** 프로젝트별 계약탭 innerText fetch → extractContractTab (값 렌더까지 폴링) */
async function fetchContractTabs(ctx, projectIds) {
  const base = ctx.plinkconnectBase || 'https://connect.pluglink.kr';
  const out = [];
  for (const pid of projectIds || []) {
    const page = await ctx.browserContext.newPage();
    try {
      await page.goto(`${base}/manage/projects/${pid}/contract`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // 계약 결과(일반요금제 값) + 공통서류(합의서 등 첨부)는 서로 다른 시점에 채워진다.
      //   라벨만 보고 읽으면 값/첨부를 놓치므로, innerText가 "안정"(연속 2회 동일 길이)되고
      //   계약 결과 값이 렌더될 때까지 폴링한다 — 늦게 뜨는 합의서 첨부까지 캡처.
      let info, prevLen = -1;
      const RETRIES = 14;
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        const text = await page.evaluate(() => document.body.innerText);
        info = extractContractTab(text);
        const stable = text.length === prevLen;
        if (isContractTabLoaded(info) && stable) break;
        prevLen = text.length;
        if (attempt < RETRIES - 1) await page.waitForTimeout(700);
      }
      out.push({ projectId: String(pid), ...info, loaded: isContractTabLoaded(info) });
    } catch (e) {
      out.push({ projectId: String(pid), error: (e?.message ?? String(e)).slice(0, 100) });
    } finally {
      await page.close();
    }
  }
  return out;
}

/** 체커 시그니처 */
export async function checkRate(station, ctx) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${RATE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${RATE_GID}`;
    const csv = await ctx.fetchSheetCsv(url);
    const rows = parseCsv(csv);
    const result = judgeRate(station, rows);
    // 시트 기준 FAIL이면 플링커넥트 계약탭으로 2차 확인 (시트 오기재 산정)
    if (result.status === 'FAIL' && ctx.browserContext) {
      try {
        const contractInfos = await fetchContractTabs(ctx, station.projectIds);
        return reconcileWithContract(result, station, contractInfos);
      } catch (e) {
        const msg = (e?.message ?? String(e)).slice(0, 100);
        return { ...result, evidence: { ...result.evidence, contractTabError: msg } };
      }
    }
    return result;
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
