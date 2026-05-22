import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRate } from '../lib/check_rate.js';

test('judgeRate: PASS — 모든 충전기 매칭 + 특가 아님', () => {
  const r = judgeRate({
    contractRateName: '기본요금-Standard',
    hasSpecialAgreementFile: false,
    appliedChargers: ['DEV001', 'DEV002'],
    projectChargers: ['DEV001', 'DEV002']
  });
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.diff, []);
});

test('judgeRate: PASS — 특가지만 합의서 있고 모두 매칭', () => {
  const r = judgeRate({
    contractRateName: '특가-기본료포함-A',
    hasSpecialAgreementFile: true,
    appliedChargers: ['DEV001'],
    projectChargers: ['DEV001']
  });
  assert.equal(r.status, 'PASS');
});

test('judgeRate: FAIL — 특가인데 합의서 없음', () => {
  const r = judgeRate({
    contractRateName: '특가-기본료포함-A',
    hasSpecialAgreementFile: false,
    appliedChargers: ['DEV001'],
    projectChargers: ['DEV001']
  });
  assert.equal(r.status, 'FAIL');
  assert.match(r.message, /합의서/);
});

test('judgeRate: FAIL — 충전기 차집합 발생', () => {
  const r = judgeRate({
    contractRateName: '기본요금',
    hasSpecialAgreementFile: false,
    appliedChargers: ['DEV001', 'DEV003'],
    projectChargers: ['DEV001', 'DEV002']
  });
  assert.equal(r.status, 'FAIL');
  assert.deepEqual(r.evidence.diff.sort(), ['DEV002', 'DEV003']);
});
