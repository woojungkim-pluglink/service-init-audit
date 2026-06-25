import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTicketId, isImageFile, hasImage, toDateOnly, decideWrite } from '../lib/logic.js';

test('extractTicketId: T-숫자 추출', () => {
  assert.equal(extractTicketId('T-547438'), '547438');
  assert.equal(extractTicketId('  T-549877 '), '549877');
});
test('extractTicketId: 메모/빈칸은 null', () => {
  assert.equal(extractTicketId('거점별 1기만 사진 확보하여 재요청'), null);
  assert.equal(extractTicketId(''), null);
  assert.equal(extractTicketId(null), null);
});
test('isImageFile: 확장자 판별', () => {
  assert.equal(isImageFile({ name: 'KakaoTalk_20250814.jpg' }), true);
  assert.equal(isImageFile({ url: 'https://images.pluglink.kr/x.PNG' }), true);
  assert.equal(isImageFile({ name: 'report.pdf' }), false);
  assert.equal(isImageFile({ name: 'noext' }), false);
});
test('hasImage', () => {
  assert.equal(hasImage([{ name: 'a.pdf' }, { name: 'b.jpg' }]), true);
  assert.equal(hasImage([{ name: 'a.pdf' }]), false);
  assert.equal(hasImage([]), false);
  assert.equal(hasImage(null), false);
});
test('toDateOnly', () => {
  assert.equal(toDateOnly('2026-01-22 00:00:00'), '2026-01-22');
  assert.equal(toDateOnly('2026-01-22'), '2026-01-22');
  assert.equal(toDateOnly(''), null);
  assert.equal(toDateOnly(null), null);
});
test('decideWrite: 완료+이미지 → write', () => {
  const r = decideWrite({ status: 'COMPLETED', completedAt: '2026-01-22 00:00:00', files: [{ name: 'a.jpg' }] });
  assert.deepEqual(r, { ok: true, value: '2026-01-22', reason: 'write' });
});
test('decideWrite: 미완료 → wait', () => {
  assert.equal(decideWrite({ status: 'RECEIVED', completedAt: null, files: [] }).reason, 'wait');
});
test('decideWrite: 완료지만 이미지 없음 → no_image', () => {
  const r = decideWrite({ status: 'COMPLETED', completedAt: '2026-01-22 00:00:00', files: [{ name: 'x.pdf' }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_image');
});
test('decideWrite: 완료+이미지지만 날짜 이상 → bad_date', () => {
  const r = decideWrite({ status: 'COMPLETED', completedAt: '', files: [{ name: 'a.jpg' }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_date');
});
