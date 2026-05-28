import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRate, extractPrice } from '../lib/check_rate.js';

// 시트 wide row 생성: B=projectId, AY=basic, AZ=special, BA=period
function mkRow(projectId, basic, special, period = '') {
  const c = new Array(60).fill('');
  c[1] = projectId;
  c[50] = basic;
  c[51] = special;
  c[52] = period;
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
