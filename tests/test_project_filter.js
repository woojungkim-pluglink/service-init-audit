import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedProject } from '../lib/project_filter.js';

test('isExcludedProject: [HM] 태그 있으면 제외', () => {
  assert.equal(isExcludedProject('25년환경부_[HM]현대2차아파트_1차'), true);
  assert.equal(isExcludedProject('[HM] 어떤프로젝트'), true);
  assert.equal(isExcludedProject('어떤프로젝트[HM]'), true);
});

test('isExcludedProject: 대소문자·공백 허용', () => {
  assert.equal(isExcludedProject('[hm]프로젝트'), true);
  assert.equal(isExcludedProject('[ HM ]프로젝트'), true);
});

test('isExcludedProject: [EP](한화) 태그도 제외', () => {
  assert.equal(isExcludedProject('[EP]대구 북구 칠곡부영5단지아파트_1차'), true);
  assert.equal(isExcludedProject('[ ep ]프로젝트'), true);
});

test('isExcludedProject: 파트너 태그 없으면 포함', () => {
  assert.equal(isExcludedProject('25년환경부_화성아파트_2차'), false);
  assert.equal(isExcludedProject('25년환경부_창포2차아이파크_1차(대기5946,접수1/5)'), false);
  assert.equal(isExcludedProject('HM아파트'), false); // 대괄호 없는 HM은 제외 아님
  assert.equal(isExcludedProject('EP빌라'), false);   // 대괄호 없는 EP는 제외 아님
  assert.equal(isExcludedProject(''), false);
  assert.equal(isExcludedProject(null), false);
  assert.equal(isExcludedProject(undefined), false);
});
