import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRate, extractPrice, extractContractTab, reconcileWithContract } from '../lib/check_rate.js';

// 시트 wide row 생성: B(1)=projectId, BD(55)=basic, BF(57)=special, BG(58)=period
function mkRow(projectId, basic, special, period = '') {
  const c = new Array(60).fill('');
  c[1] = projectId;
  c[55] = basic;
  c[57] = special;
  c[58] = period;
  return c;
}

const charger = (rate) => ({ chargerId: 'X', deviceId: 'Y', appliedRate: rate, initiatedAt: '2026-05-28' });

test('extractPrice: "특가요금 (149원)" → "149"', () => {
  assert.equal(extractPrice('특가요금 (149원)'), '149');
  assert.equal(extractPrice('공동주택 특가요금(149원)'), '149');
  assert.equal(extractPrice('플러그링크 공시요금 (324.4원)'), '324.4');
  assert.equal(extractPrice('미적용'), null);
});

test('judgeRate: PASS — 특약 149원 매칭', () => {
  const rows = [mkRow('22834', '공동주택 고압', '공동주택 특가요금(149원)', '365')];
  const station = { projectIds: ['22834'], newChargers: [charger('특가요금 (149원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'PASS');
});

test('judgeRate: PASS — 특약 미적용 + 충전기 공시요금', () => {
  const rows = [mkRow('813', '공동주택 고압', '미적용', '0')];
  const station = { projectIds: ['813'], newChargers: [charger('플러그링크 공시요금 (324.4원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'PASS');
});

test('judgeRate: FAIL — 특약 149 합의인데 충전기 220원 적용', () => {
  const rows = [mkRow('916', '공동주택 고압', '공동주택 특가요금(149원)', '365')];
  const station = { projectIds: ['916'], newChargers: [charger('특가요금 (220원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'FAIL');
});

test('judgeRate: FAIL — 특약 미적용 합의인데 충전기 특가요금 적용', () => {
  const rows = [mkRow('813', '공동주택 고압', '미적용', '0')];
  const station = { projectIds: ['813'], newChargers: [charger('특가요금 (149원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'FAIL');
});

test('judgeRate: SKIP — 시트에 프로젝트번호 행 없음', () => {
  const rows = [mkRow('999', '공동주택 고압', '미적용', '0')];
  const station = { projectIds: ['11111'], newChargers: [charger('특가요금 (149원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.reason, 'ROW_NOT_FOUND');
});

test('judgeRate: SKIP — projectIds 비어있음', () => {
  const r = judgeRate({ projectIds: [], newChargers: [charger('특가요금 (149원)')] }, []);
  assert.equal(r.status, 'SKIP');
});

test('judgeRate: SKIP — 신규 충전기 없음', () => {
  const rows = [mkRow('813', '공동주택 고압', '미적용', '0')];
  const r = judgeRate({ projectIds: ['813'], newChargers: [] }, rows);
  assert.equal(r.status, 'SKIP');
});

test('judgeRate: PASS — projectIds 여러 개, 일부 시트에만 있음, 매칭됨', () => {
  const rows = [
    mkRow('3451', '공동주택 고압', '미적용', '0'),         // 예전 프로젝트
    mkRow('27294', '공동주택 고압', '미적용', '0')         // 현재 프로젝트, 기본요금
  ];
  const station = {
    projectIds: ['27294', '3451'],
    newChargers: [charger('플러그링크 공시요금 (324.4원)')]
  };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'PASS');
});

test('judgeRate: 충전기 여러 요금제, 모두 매칭', () => {
  const rows = [mkRow('22834', '공동주택 고압', '공동주택 특가요금(149원)', '365')];
  const station = {
    projectIds: ['22834'],
    newChargers: [charger('특가요금 (149원)'), charger('특가요금 (149원)')]
  };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'PASS');
});

// ── 온톨로지 대조 개선: 계약정보 공란·파트너 요금·기본요금 공백 정규화 ──

test('judgeRate: 시트 계약정보 전부 공란 → FAIL이 아니라 SKIP(CONTRACT_BLANK)', () => {
  const rows = [mkRow('27182', '', '', '')];
  const station = { projectIds: ['27182'], newChargers: [charger('플러그링크 공시요금 (324.4원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.reason, 'CONTRACT_BLANK');
  assert.equal(r.evidence.appliedRates[0].matched, false); // 계약탭 reconcile 입력용
});

test('judgeRate: 파트너(한화모티브) 요금 적용 → SKIP(PARTNER_FEE) — FAIL 오탐 방지', () => {
  const rows = [mkRow('22540', '', '', '')];
  const station = { projectIds: ['22540'], newChargers: [charger('한화모티브 완속 (283원)')] };
  const r = judgeRate(station, rows);
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.reason, 'PARTNER_FEE');
});

test('judgeRate: "플러그링크 기본 요금"(띄어쓰기)도 기본요금 계열 인식', () => {
  const rows = [mkRow('813', '공동주택 고압', '미적용', '0')];
  const station = { projectIds: ['813'], newChargers: [charger('플러그링크 기본 요금')] };
  assert.equal(judgeRate(station, rows).status, 'PASS');
});

// ── 계약탭 2차 확인 (영업관리 시트 오기재 산정) ──

const CONTRACT_TEXT_149 = `계약 결과
계약 기간
일반요금제
플러그링크 공시요금 (324.4원)
특약요금제
특가요금 (149원)
특약요금제 적용기간(일)
365
무료충전기간(일)
0
공통서류
토탈솔루션계약서
괴평무지개아파트 토탈솔루션계약서.pdf
괴평무지개아파트 합의서.pdf
합의서
-`;

test('extractContractTab: 특약요금제/적용기간/합의서 파일 추출', () => {
  const c = extractContractTab(CONTRACT_TEXT_149);
  assert.equal(c.specialRate, '특가요금 (149원)');
  assert.equal(c.specialPrice, '149');
  assert.equal(c.specialPeriod, '365');
  assert.equal(c.generalRate, '플러그링크 공시요금 (324.4원)');
  assert.equal(c.hasAgreementFile, true); // 슬롯은 "-"여도 타 영역 합의서.pdf 인정
});

test('extractContractTab: NFD(분해형) 한글 합의서 파일명도 인식', () => {
  // 업로드 파일명이 분해형 한글일 때 ("요금합의서" → NFD)
  const nfd = `일반요금제\n플러그링크 공시요금 (324.4원)\n특약요금제\n특가요금 (149원)\n특약요금제 적용기간(일)\n180\n토탈솔루션계약서\n동문동_요금합의서.pdf`.normalize('NFD');
  const c = extractContractTab(nfd);
  assert.equal(c.specialPrice, '149');
  assert.equal(c.hasAgreementFile, true);
});

test('extractContractTab: 합의서 파일 없으면 false', () => {
  const c = extractContractTab(`특약요금제\n특가요금 (149원)\n특약요금제 적용기간(일)\n365\n합의서\n-`);
  assert.equal(c.hasAgreementFile, false);
  assert.equal(c.specialPrice, '149');
});

test('extractContractTab: 합의서 슬롯 "-"여도 토탈솔루션계약서 PDF 있으면 인정 (계약서 2페이지 합의서)', () => {
  // 실제 계약탭 구조: 합의서는 토탈솔루션계약서 PDF에 합쳐 올림 → 합의서 슬롯은 "-"
  const t = `일반요금제\n플러그링크 공시요금 (324.4원)\n특약요금제\n특가요금 (149원)\n특약요금제 적용기간(일)\n180\n공통서류\n건축물대장\n\n4. 건대_방학신동아3단지.pdf\n\n토탈솔루션계약서\n\n5. 계약서_방학신동아3단지.pdf\n\n합의서\n-\n전기요금고지서\n\n1. 신청서_방학신동아3단지.pdf`;
  const c = extractContractTab(t);
  assert.equal(c.hasAgreementFile, true);
  assert.equal(c.specialPrice, '149');
  assert.equal(c.specialPeriod, '180');
});

test('extractContractTab: 토탈솔루션계약서도 "-"면 여전히 false', () => {
  const t = `특약요금제\n특가요금 (149원)\n특약요금제 적용기간(일)\n180\n토탈솔루션계약서\n-\n합의서\n-`;
  assert.equal(extractContractTab(t).hasAgreementFile, false);
});

function failResult(price) {
  return {
    status: 'FAIL',
    evidence: { appliedRates: [{ rate: `특가요금 (${price}원)`, price: String(price), matched: false }] },
    message: `계약 불일치: 특가요금 (${price}원)`
  };
}

test('reconcileWithContract: 계약탭 특약요금 일치 + 합의서 첨부 → PASS', () => {
  const r = reconcileWithContract(failResult(149), { projectIds: ['24446'] }, [
    { projectId: '24446', specialPrice: '149', specialPeriod: '365', hasAgreementFile: true }
  ]);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.reconciledBy, 'CONTRACT_TAB');
});

test('reconcileWithContract: 특약요금 일치하나 합의서 미첨부 → WARN', () => {
  const r = reconcileWithContract(failResult(149), { projectIds: ['24446'] }, [
    { projectId: '24446', specialPrice: '149', specialPeriod: '365', hasAgreementFile: false }
  ]);
  assert.equal(r.status, 'WARN');
});

test('reconcileWithContract: 적용기간 0 → 특약 비활성 → FAIL 유지', () => {
  const r = reconcileWithContract(failResult(149), { projectIds: ['24446'] }, [
    { projectId: '24446', specialPrice: '149', specialPeriod: '0', hasAgreementFile: true }
  ]);
  assert.equal(r.status, 'FAIL');
});

test('reconcileWithContract: 계약탭 가격도 불일치 → FAIL 유지', () => {
  const r = reconcileWithContract(failResult(220), { projectIds: ['24446'] }, [
    { projectId: '24446', specialPrice: '149', specialPeriod: '365', hasAgreementFile: true }
  ]);
  assert.equal(r.status, 'FAIL');
});

test('reconcileWithContract: 계약탭 fetch 실패(에러)만 있으면 FAIL 유지', () => {
  const r = reconcileWithContract(failResult(149), { projectIds: ['24446'] }, [
    { projectId: '24446', error: 'timeout' }
  ]);
  assert.equal(r.status, 'FAIL');
});

// ── CONTRACT_BLANK 베이스의 계약탭 재조정 ──

function blankResult(price, rate) {
  return {
    status: 'SKIP',
    evidence: {
      reason: 'CONTRACT_BLANK',
      contracts: [{ projectId: 'x', basicRate: '', specialRate: '', specialPeriod: '', hasSpecial: false, expectedPrice: null }],
      appliedRates: [{ rate, price: String(price), matched: false }]
    },
    message: '영업관리 시트 계약정보 공란 — 계약탭 2차 확인 필요'
  };
}

test('reconcile(공란): 계약탭 일반요금제 일치 → PASS(CONTRACT_TAB_GENERAL) — 실측 오탐 12건 케이스', () => {
  const r = reconcileWithContract(blankResult('324.4', '플러그링크 공시요금 (324.4원)'), { projectIds: ['27182'] }, [
    { projectId: '27182', specialPrice: null, specialPeriod: '0', generalRate: '플러그링크 공시요금 (324.4원)', hasAgreementFile: false, loaded: true }
  ]);
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.reconciledBy, 'CONTRACT_TAB_GENERAL');
});

test('reconcile(공란): 계약탭에 활성 특약이 있는데 충전기 요금 불일치 → FAIL (일반요금 구제 금지)', () => {
  const r = reconcileWithContract(blankResult('283', '어떤요금 (283원)'), { projectIds: ['1'] }, [
    { projectId: '1', specialPrice: '149', specialPeriod: '180', generalRate: '플러그링크 공시요금 (324.4원)', hasAgreementFile: true, loaded: true }
  ]);
  assert.equal(r.status, 'FAIL');
});

test('reconcile(공란): 계약탭 미로드/에러 → SKIP 유지(확인 불가)', () => {
  const r = reconcileWithContract(blankResult('324.4', '플러그링크 공시요금 (324.4원)'), { projectIds: ['1'] }, [
    { projectId: '1', error: 'timeout' }
  ]);
  assert.equal(r.status, 'SKIP');
  assert.equal(r.evidence.reconciledBy, 'CONTRACT_BLANK');
});

test('reconcile: 시트가 특약 계약인데 충전기 공시요금 — 계약탭 일반요금 일치로 구제 안 됨(진짜 오적용 보존)', () => {
  // 2026-07-01 실제 양성 케이스: 시트 특약 149원, 충전기 공시요금 324.4원
  const base = {
    status: 'FAIL',
    evidence: {
      contracts: [{ projectId: '26762', basicRate: '공동주택 저압', specialRate: '공동주택 특가요금(149원)', specialPeriod: '180', hasSpecial: true, expectedPrice: '149' }],
      appliedRates: [{ rate: '플러그링크 공시요금 (324.4원)', price: '324.4', matched: false }]
    },
    message: '계약 불일치: 플러그링크 공시요금 (324.4원)'
  };
  const r = reconcileWithContract(base, { projectIds: ['26762'] }, [
    { projectId: '26762', specialPrice: '149', specialPeriod: '180', generalRate: '플러그링크 공시요금 (324.4원)', hasAgreementFile: true, loaded: true }
  ]);
  assert.equal(r.status, 'FAIL');
});
