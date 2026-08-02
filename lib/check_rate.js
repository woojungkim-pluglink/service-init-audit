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

/** 기본요금 계열인지 (특약 아님): "공시요금", "기본요금", "고압", "저압" 또는 자사(플러그링크) 요금명.
 *  공백 정규화 — 실데이터 '플러그링크 기본 요금'(띄어쓰기) 존재.
 *  '플러그링크' 포함 요금은 리네임에 견고하게 기본 계열로 취급(2026-08 '플러그링크 완속' 리네임 실측)
 *  — 특가/특약/단기는 선행 배제되고, 파트너 요금(한화모티브 완속)은 '플러그링크'가 없어 제외됨. */
function isBasicRateText(s) {
  if (!s) return false;
  const v = String(s).replace(/\s/g, '');
  if (/특가|특약|단기/.test(v)) return false;
  return /공시요금|기본요금|고압|저압|플러그링크/.test(v);
}

/** 파트너(한화모티브 등) 요금그룹 요금인지 — 자사(플러그링크) 요금 검증 대상이 아님.
 *  온톨로지 charging-core.object.group-of-fee: 요금 그룹은 파트너별 요금 묶음. */
const PARTNER_FEE_RE = /한화모티브/;
export function isPartnerFeeText(s) {
  return PARTNER_FEE_RE.test(String(s || ''));
}

// ── 플러그링크 공시요금(기본요금) 고시가 이력 ──
//   효력시작일 내림차순. 인하/인상 시 여기에 한 줄 추가하면 판정에 반영된다.
//   '공시요금' 라벨 충전기의 단가가 검증일 기준 현재 고시가와 다르면(구단가 잔존) 불일치로 잡는다.
//   ※ 고압/저압 등 다른 기본요금 계열에는 단가 강제하지 않음(공시요금 라벨 한정 — 오탐 방지).
const PLUGLINK_NOTICE_PRICE_HISTORY = [
  { from: '2026-08-01', price: '292' },   // 2026-08-01 인하
  { from: '0000-01-01', price: '324.4' }  // 이전 고시가
];

/** 공시요금(고시가) 계열 라벨인지 — 구명칭 '플러그링크 공시요금' + 신명칭 '플러그링크 완속'(2026-08 리네임).
 *  이 계열만 고시가 이력과 단가 대조(구단가 잔존 감지). 공백 정규화. */
function isPublicNoticeRate(s) {
  return /공시요금|플러그링크완속/.test(String(s || '').replace(/\s/g, ''));
}

/** 기준일(YYYY-MM-DD)의 플러그링크 공시요금 고시가. 기준일 없으면 null(강제 안 함). */
export function expectedNoticePrice(date) {
  if (!date) return null;
  return PLUGLINK_NOTICE_PRICE_HISTORY.find(e => date >= e.from)?.price ?? null;
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
 *   + '공시요금' 라벨이면 단가가 기준일의 고시가와도 일치해야 함(구단가 잔존 감지, refDate 없으면 생략)
 */
function matchesAnyContract(chargerRate, contracts, refDate = null) {
  if (!chargerRate) return false;
  const chargerPrice = extractPrice(chargerRate);
  return contracts.some(c => {
    if (c.hasSpecial) {
      return c.expectedPrice && chargerPrice === c.expectedPrice;
    }
    if (!isBasicRateText(chargerRate)) return false;
    if (isPublicNoticeRate(chargerRate) && chargerPrice) {
      const exp = expectedNoticePrice(refDate);
      if (exp && chargerPrice !== exp) return false; // 예: 8/1 이후 324.4원 잔존 → 불일치
    }
    return true;
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

  // 파트너(한화모티브 등) 요금이 적용된 충전소는 자사 요금 검증 대상이 아님 —
  //   프로젝트 태그([HM]/[EP]) 누락 시에도 요금명으로 구분해 FAIL 오탐을 막는다.
  const appliedRatesRaw = [...new Set((station.newChargers || []).map(c => c.appliedRate).filter(Boolean))];
  if (appliedRatesRaw.length > 0 && appliedRatesRaw.every(isPartnerFeeText)) {
    return {
      status: 'SKIP',
      evidence: { reason: 'PARTNER_FEE', appliedRates: appliedRatesRaw },
      message: `파트너 요금 적용(${appliedRatesRaw.join(', ')}) — 자사 요금 검증 대상 아님 (프로젝트 파트너 태그 확인 필요)`
    };
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
  const appliedRates = appliedRatesRaw;
  if (appliedRates.length === 0) {
    return {
      status: 'SKIP',
      evidence: { contracts, appliedRates: [] },
      message: '신규 충전기 적용 요금제 정보 없음'
    };
  }

  // 계약정보 부재 — 매칭 행의 기본·특약이 모두 공란이면 '기본요금 계약'으로 단정하지 않는다
  //   (실측: rate FAIL 16건 중 12건이 이 케이스의 오탐). 계약탭 2차 확인으로 넘긴다.
  if (contracts.every(c => !c.basicRate && !c.specialRate)) {
    const perRate = appliedRates.map(r => ({ rate: r, price: extractPrice(r), matched: false }));
    return {
      status: 'SKIP',
      evidence: { reason: 'CONTRACT_BLANK', contracts, appliedRates: perRate },
      message: '영업관리 시트 계약정보 공란 — 계약탭 2차 확인 필요'
    };
  }

  const refDate = station.initiatedAt ?? null;
  const perRate = appliedRates.map(r => ({
    rate: r,
    price: extractPrice(r),
    matched: matchesAnyContract(r, contracts, refDate)
  }));
  const allMatched = perRate.every(p => p.matched);
  const expNotice = expectedNoticePrice(refDate);
  const evidence = { contracts, appliedRates: perRate, ...(expNotice ? { expectedNoticePrice: expNotice } : {}) };

  if (allMatched) {
    return {
      status: 'PASS',
      evidence,
      message: `${appliedRates.length}종 요금제 모두 계약 일치`
    };
  }
  const failed = perRate.filter(p => !p.matched);
  const failedRates = failed.map(p => p.rate);
  // 공시요금 구단가 잔존이면 원인을 명시(예: 8/1 인하 미반영)
  const staleNotice = expNotice
    ? failed.filter(p => isPublicNoticeRate(p.rate) && p.price && p.price !== expNotice)
    : [];
  const noticeHint = staleNotice.length
    ? ` — 공시요금 구단가 잔존 의심(현재 고시가 ${expNotice}원)`
    : '';
  return {
    status: 'FAIL',
    evidence,
    message: `계약 불일치: ${failedRates.join(', ')}${noticeHint}`
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
  // 합의서는 (a) 별도 파일(합의서*.pdf)로 올리거나, (b) 토탈솔루션계약서 PDF에 합쳐(계약서 2페이지)
  //   올린다. 합의서 슬롯이 "-"여도 토탈솔루션계약서 PDF가 있으면 합의서 포함으로 인정.
  const totalContractVal = t.match(/토탈솔루션계약서[ \t]*\n+[ \t]*([^\n]+)/)?.[1] || '';
  const hasAgreementFile = /합의서[^\n]*\.pdf/.test(t) || /\.pdf/i.test(totalContractVal);
  return {
    specialRate,
    specialPrice: extractPrice(specialRate),
    specialPeriod,
    generalRate,
    hasAgreementFile
  };
}

/**
 * 시트 기준 FAIL/계약정보공란(CONTRACT_BLANK)을 플링커넥트 계약탭 근거로 재조정 (순수, 테스트 대상).
 * - 불일치 요금이 모두 계약탭 특약요금(적용기간>0)으로 설명되고 합의서 첨부 → PASS (시트 오기재 추정)
 * - 특약으로 설명되나 합의서 미첨부 → WARN
 * - 특약 기대가 전혀 없을 때(시트·계약탭 모두) 계약탭 일반요금제와 일치 → PASS
 *   ※ 시트 또는 계약탭이 활성 특약을 기대하면 일반요금 일치로 구제하지 않는다 —
 *     '특약 계약인데 공시요금 적용'(진짜 오적용)을 PASS로 덮지 않기 위함.
 * - 그 외 → FAIL 유지 (공란 베이스는 계약탭도 확인 불가 시 SKIP)
 */
export function reconcileWithContract(baseResult, station, contractInfos) {
  const applied = baseResult.evidence?.appliedRates || [];
  const failedRates = applied.filter(p => !p.matched);
  // 로드 실패(error/타임아웃)는 "특약 없음"으로 오판하지 않도록 제외
  const infos = (contractInfos || []).filter(c => c && !c.error && c.loaded !== false);
  const activePrices = new Set(
    infos.filter(c => c.specialPrice && Number(c.specialPeriod) > 0).map(c => c.specialPrice)
  );
  const generalPrices = new Set(infos.map(c => extractPrice(c.generalRate)).filter(Boolean));
  const anyAgreement = infos.some(c => c.hasAgreementFile);
  const blankBase = baseResult.evidence?.reason === 'CONTRACT_BLANK';
  const evidence = { ...baseResult.evidence, contractTab: contractInfos };

  // 특약 기대: 시트에 활성 특약이 있거나 계약탭에 활성 특약(기간>0)이 있으면 일반요금 구제 금지
  const sheetExpectsSpecial = (baseResult.evidence?.contracts || []).some(c => c.hasSpecial && c.expectedPrice);
  const allowGeneral = activePrices.size === 0 && !sheetExpectsSpecial;
  // 공시요금 라벨은 계약탭과 일치해도 현재 고시가와 달라야 하면 구제 금지
  //   (예: 8/1 인하 후 계약탭·충전기 모두 구단가 324.4원이면 '일치'가 아니라 '인하 미반영')
  const expNotice = expectedNoticePrice(station?.initiatedAt ?? null);
  const noticeOk = (p) => !expNotice || !isPublicNoticeRate(p.rate) || !p.price || p.price === expNotice;
  // 계약탭 generalRate가 계약 당시 구고시가 스냅샷일 수 있음(실측: 계약탭 324.4원 vs 충전기 292원).
  //   충전기가 공시요금 계열 + 현재 고시가와 정확히 일치하면, 계약탭도 공시요금 계열인 한 단가
  //   스냅샷 차이는 일치로 인정(요금 개정 직후 오탐 방지).
  const tabGeneralNotice = infos.some(c => isPublicNoticeRate(c.generalRate));
  const classify = (p) => {
    if (activePrices.has(p.price)) return 'special';
    if (!allowGeneral) return null;
    if (generalPrices.has(p.price) && noticeOk(p)) return 'general';
    if (tabGeneralNotice && isPublicNoticeRate(p.rate) && expNotice && p.price === expNotice) return 'general';
    return null;
  };

  const unexplained = failedRates.filter(p => !classify(p));
  if (unexplained.length > 0 || failedRates.length === 0) {
    if (blankBase) {
      if (infos.length === 0 || (activePrices.size === 0 && generalPrices.size === 0)) {
        return {
          status: 'SKIP',
          evidence: { ...evidence, reconciledBy: 'CONTRACT_BLANK' },
          message: '계약정보 확인 불가 — 영업관리 시트 공란 + 계약탭 요금 정보 없음/미로드'
        };
      }
      return { status: 'FAIL', evidence, message: '영업관리 시트 공란 + 계약탭 요금과도 불일치' };
    }
    return { status: 'FAIL', evidence, message: `${baseResult.message} (계약탭에도 특약요금 불일치)` };
  }

  const usedSpecial = failedRates.some(p => classify(p) === 'special');
  if (usedSpecial && !anyAgreement) {
    const priceLabel = [...activePrices].map(p => `${p}원`).join(',');
    return {
      status: 'WARN',
      evidence: { ...evidence, reconciledBy: 'CONTRACT_TAB_NO_AGREEMENT' },
      message: `계약탭 특약요금(${priceLabel}) 일치하나 합의서 미첨부 — 확인 필요`
    };
  }
  if (!usedSpecial) {
    const gLabel = [...generalPrices].map(p => `${p}원`).join(',');
    return {
      status: 'PASS',
      evidence: { ...evidence, reconciledBy: 'CONTRACT_TAB_GENERAL' },
      message: `계약탭 확인 — 일반요금제(${gLabel}) 일치 (영업관리 시트 ${blankBase ? '공란' : '오기재'} 추정)`
    };
  }
  const priceLabel = [...activePrices].map(p => `${p}원`).join(',');
  return {
    status: 'PASS',
    evidence: { ...evidence, reconciledBy: 'CONTRACT_TAB' },
    message: `계약탭 확인 — 특약요금(${priceLabel}) 일치 + 합의서 첨부 (영업관리 시트 ${blankBase ? '공란' : '오기재'} 추정)`
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
    // 시트 기준 FAIL 또는 계약정보 공란이면 플링커넥트 계약탭으로 2차 확인 (시트 오기재/공란 산정)
    const needsTab = result.status === 'FAIL' || result.evidence?.reason === 'CONTRACT_BLANK';
    if (needsTab && ctx.browserContext) {
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
