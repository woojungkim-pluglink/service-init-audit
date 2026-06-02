import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractStationMeta, isStationMetaComplete, isChargerNormal, filterNewChargers } from '../lib/enrich_station.js';

const text = readFileSync(new URL('./fixtures/station_page_text.txt', import.meta.url), 'utf8');

test('extractStationMeta: stationId 정확', () => {
  const m = extractStationMeta(text);
  assert.equal(m.stationId, '10020322');
});

test('extractStationMeta: projectIds 콤마 구분 다중', () => {
  const m = extractStationMeta(text);
  assert.deepEqual(m.projectIds, ['26404', '22677']);
});

test('extractStationMeta: address 한국 주소', () => {
  const m = extractStationMeta(text);
  assert.match(m.address, /충북.*충주시.*금릉로.*101/);
});

test('extractStationMeta: stationName 추출', () => {
  const m = extractStationMeta(text);
  assert.equal(m.stationName, '세원한아름아파트');
});

test('isStationMetaComplete: 메타 블록 렌더 완료 판정', () => {
  // 완전 렌더 (실제 station_page_text 파싱 결과와 동일 형태)
  assert.equal(isStationMetaComplete({ address: '경기 시흥시 역전로 375-8', projectIds: ['26647', '26431'] }), true);
  // 충전기 테이블만 떴고 메타 블록 미렌더 — 레이스 상황
  assert.equal(isStationMetaComplete({ address: null, projectIds: [] }), false);
  assert.equal(isStationMetaComplete({ address: '경기 시흥시 역전로 375-8', projectIds: [] }), false);
  assert.equal(isStationMetaComplete({ address: null, projectIds: ['26647'] }), false);
  assert.equal(isStationMetaComplete(null), false);
});

test('isChargerNormal: 3조건 AND', () => {
  assert.equal(isChargerNormal({
    operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: '사용가능'
  }), true);
  assert.equal(isChargerNormal({
    operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: '점검중'
  }), false);
  assert.equal(isChargerNormal({
    operationStatus: '미개시', deviceStatus: '운영', connectorStatus: '사용가능'
  }), false);
});

test('isChargerNormal: 파란불(충전준비/충전중/충전완료)은 정상 → WARN 아님', () => {
  for (const cs of ['충전준비', '충전중', '충전완료', '충전 중']) {
    assert.equal(
      isChargerNormal({ operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: cs }),
      true, `${cs} 는 정상이어야 함`
    );
  }
  for (const cs of ['사용불가', '미연결', '통신미연결']) {
    assert.equal(
      isChargerNormal({ operationStatus: '사업개시', deviceStatus: '운영', connectorStatus: cs }),
      false, `${cs} 는 비정상이어야 함`
    );
  }
});

test('filterNewChargers: today 매칭만 남김', () => {
  const chargers = [
    { chargerId: '16740', initiatedAt: '2025-01-31' },
    { chargerId: '54251', initiatedAt: '2026-05-22' },
    { chargerId: '54252', initiatedAt: '2026-05-22' }
  ];
  const out = filterNewChargers(chargers, '2026-05-22');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(c => c.chargerId), ['54251', '54252']);
});
