const state = {
  manifest: null,
  current: null,
  slotData: { morning: null, evening: null },
  filterFailOnly: false
};

const PLINKCONNECT = 'https://connect.pluglink.kr';
const stationUrl = id => `${PLINKCONNECT}/operation/stations/${id}/home`;
const projectUrl = id => `${PLINKCONNECT}/manage/projects/${id}/contract`;
// 카드 펼침 토글과 충돌하지 않도록 stopPropagation
const linkTag = (href, label) =>
  `<a href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label}</a>`;

async function init() {
  try {
    const r = await fetch('/data/index.json');
    if (!r.ok) { loadSettle(); renderEmpty(); return; }
    state.manifest = await r.json();
    // empty 마커(개시 없는 날 — 백업 cron dedup용)는 대시보드에 표시하지 않음
    state.manifest.slots = (state.manifest.slots || []).filter(s => s.file && !s.empty);
  } catch (e) {
    loadSettle();
    renderEmpty();
    return;
  }
  document.getElementById('last-updated').textContent =
    '마지막 갱신: ' + new Date(state.manifest.lastUpdated).toLocaleString('ko-KR');
  loadSettle(); // 날짜 선택과 무관한 현재 스냅샷 — 비동기 병행
  renderSidebar();
  const dates = uniqueDates(state.manifest.slots).reverse();
  if (dates.length) await selectDate(dates[0]);
  else renderEmpty();

  document.getElementById('filter-fail-only').addEventListener('change', (e) => {
    state.filterFailOnly = e.target.checked;
    renderBody();
  });
}

function renderEmpty() {
  document.getElementById('header').textContent = '';
  document.getElementById('summary').innerHTML = '아직 검증 데이터가 없습니다.';
  document.getElementById('slot-morning').innerHTML = '';
  document.getElementById('slot-evening').innerHTML = '';
}

function uniqueDates(slots) {
  return [...new Set(slots.map(s => s.date))].sort();
}

function renderSidebar() {
  const ul = document.getElementById('date-list');
  ul.innerHTML = '';
  for (const d of uniqueDates(state.manifest.slots).reverse()) {
    const slotsForDate = state.manifest.slots.filter(s => s.date === d);
    const li = document.createElement('li');
    li.dataset.date = d;
    li.innerHTML = `<span>${d}</span><span>${slotsForDate.map(s => `<span class="dot ${s.slot}"></span>`).join('')}</span>`;
    li.addEventListener('click', () => selectDate(d));
    ul.appendChild(li);
  }
}

async function selectDate(date) {
  state.current = date;
  for (const li of document.querySelectorAll('#date-list li')) {
    li.classList.toggle('active', li.dataset.date === date);
  }
  state.slotData.morning = await loadSlot(date, 'morning');
  state.slotData.evening = await loadSlot(date, 'evening');
  renderBody();
}

async function loadSlot(date, slot) {
  const entry = state.manifest.slots.find(s => s.date === date && s.slot === slot);
  if (!entry) return null;
  try {
    const r = await fetch('/data/' + entry.file);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function renderBody() {
  document.getElementById('header').textContent = `${state.current}`;
  renderSummary();
  renderSlot('morning', '아침(8AM 알림)');
  renderSlot('evening', '저녁(5PM 알림)');
  renderTomorrow();
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function withWeekday(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${date}(${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

function renderTomorrow() {
  const el = document.getElementById('slot-tomorrow');
  const evening = state.slotData.evening;
  const tomorrowStations = evening?.tomorrowStations || [];
  const tSummary = evening?.tomorrowSummary;
  if (!tSummary || (tomorrowStations.length === 0 && !(tSummary.dates?.length))) {
    el.innerHTML = '';
    return;
  }
  // 대상일: summary.dates(빈 날짜 포함) 우선, 없으면 데이터에서 추출
  const dates = tSummary.dates?.length
    ? tSummary.dates
    : [...new Set(tomorrowStations.map(s => s.initiatedAt))].sort();
  const rangeLabel = dates.length === 1
    ? `내일(${withWeekday(dates[0])})`
    : `다음(${withWeekday(dates[0])}~${withWeekday(dates[dates.length - 1])})`;

  let body;
  if (dates.length <= 1) {
    body = tomorrowStations.map(renderTomorrowCard).join('');
  } else {
    body = dates.map(d => {
      const group = tomorrowStations.filter(s => s.initiatedAt === d);
      const cards = group.length
        ? group.map(renderTomorrowCard).join('')
        : `<div class="meta" style="padding:4px 0">(없음)</div>`;
      return `<div class="meta" style="margin-top:8px"><b>${escapeHtml(withWeekday(d))} · ${group.length}건</b></div>${cards}`;
    }).join('');
  }

  const tb = tSummary.byOverall;
  const statusLine = tb ? ` &nbsp;·&nbsp; 통신 PASS ${tb.PASS || 0} · WARN ${tb.WARN || 0} · FAIL ${tb.FAIL || 0} · SKIP ${tb.SKIP || 0}` : '';
  el.innerHTML = `
    <div class="slot-title">🌅 ${escapeHtml(rangeLabel)} 개시 예정 (${tomorrowStations.length}건) · 영차영차new BR + 통신상태${statusLine}</div>
    ${body}
  `;
  for (const c of el.querySelectorAll('.card')) {
    c.addEventListener('click', () => c.classList.toggle('expanded'));
  }
}

function renderTomorrowCard(s) {
  const name = s.stationName ?? s.projectName ?? s.address ?? `proj:${s.projectId}`;
  const link = s.stationId
    ? ` ${linkTag(stationUrl(s.stationId), '🔗 플링커넥트')}`
    : (s.projectId ? ` ${linkTag(projectUrl(s.projectId), '🔗 프로젝트')}` : '');
  const st = s.checks?.status;
  const overall = s.overall || (st ? st.status : 'SKIP');
  const badge = st ? `<span class="checks"><span class="${st.status.toLowerCase()}">⚙️ 통신 ${st.status}</span></span>` : '';
  const stid = s.stationId ? `충전소 ${escapeHtml(s.stationId)} · ` : '';
  return `
    <div class="card ${overall.toLowerCase()}">
      <div><b>[${overall}]</b> ${escapeHtml(name)}${s.address && s.address !== name ? ` · ${escapeHtml(s.address)}` : ''}${link}</div>
      <div class="meta">${stid}프로젝트 ${escapeHtml(s.projectId ?? '?')} · 개시예정 ${escapeHtml(withWeekday(s.initiatedAt))}</div>
      ${badge}
      ${st && st.message ? `<div class="evidence"><div><b>⚙️ 통신</b>: ${escapeHtml(st.message)}</div></div>` : ''}
    </div>
  `;
}

function renderSummary() {
  const both = ['morning', 'evening'].map(s => state.slotData[s]).filter(Boolean);
  const totals = both.reduce((acc, d) => {
    acc.totalStations += (d.summary.totalStations ?? d.summary.totalProjects ?? 0);
    for (const k of ['PASS', 'WARN', 'FAIL', 'SKIP']) acc.byOverall[k] += d.summary.byOverall[k] || 0;
    for (const ck of ['doc', 'rate', 'status', 'sheet', 'initdate', 'comm']) {
      acc.byCheck[ck] = acc.byCheck[ck] || { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
      for (const st of ['PASS', 'WARN', 'FAIL', 'SKIP']) {
        acc.byCheck[ck][st] += d.summary.byCheck[ck]?.[st] || 0;
      }
    }
    return acc;
  }, { totalStations: 0, byOverall: { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 }, byCheck: {} });

  const checkLabels = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트', initdate: '개시일자', comm: '통신' };
  document.getElementById('summary').innerHTML = `
    총 ${totals.totalStations}건 · PASS ${totals.byOverall.PASS} · WARN ${totals.byOverall.WARN} · FAIL ${totals.byOverall.FAIL}
    <br>${Object.keys(checkLabels).map(k => `${checkLabels[k]} ${totals.byCheck[k]?.PASS || 0}/${totals.totalStations}`).join(' · ')}
  `;
}

function renderSlot(slot, title) {
  const el = document.getElementById('slot-' + slot);
  const data = state.slotData[slot];
  if (!data) { el.innerHTML = `<div class="slot-title">${title} — 데이터 없음</div>`; return; }
  let stations = data.stations ?? data.projects ?? []; // 구버전 호환
  if (state.filterFailOnly) stations = stations.filter(s => s.overall === 'FAIL' || s.overall === 'WARN');

  el.innerHTML = `<div class="slot-title">${title} (${stations.length}건)</div>` +
    stations.map(renderCard).join('');
  for (const c of el.querySelectorAll('.card')) {
    c.addEventListener('click', () => c.classList.toggle('expanded'));
  }
}

function renderCard(s) {
  const labels = { doc: '📭 공문', rate: '💰 요금제', status: '⚙️ 상태', sheet: '📊 시트', initdate: '📅 개시일자', comm: '📡 통신' };
  const checks = Object.entries(s.checks || {}).map(([k, c]) =>
    `<span class="${c.status.toLowerCase()}">${labels[k] ?? k} ${c.status}</span>`
  ).join('');
  const name = s.stationName ?? s.projectName ?? s.stationId ?? '(no name)';
  const cc = s.chargerCounts;
  // 충전기 현황: 기축(기존) + 개시(오늘) = 총. (구버전 데이터 호환 fallback)
  const countMeta = cc
    ? `충전기 기축 ${cc.existing} + 개시 ${cc.opened} = 총 ${cc.total}기`
    : `총 ${escapeHtml(String(s.totalChargers ?? (s.chargers || []).length))}기 · 신규 ${(s.newChargers || []).length}기`;
  const addr = s.address ? ` · ${escapeHtml(s.address)}` : '';
  const pids = (s.projectIds && s.projectIds.length) ? `프로젝트 ${escapeHtml(s.projectIds.join(', '))} · ` : '';
  const stid = s.stationId ? `충전소 ${escapeHtml(s.stationId)} · ` : '';
  const link = s.stationId ? ` ${linkTag(stationUrl(s.stationId), '🔗 플링커넥트')}` : '';
  return `
    <div class="card ${(s.overall || 'skip').toLowerCase()}">
      <div><b>[${s.overall ?? 'SKIP'}]</b> ${escapeHtml(name)}${addr}${link}</div>
      <div class="meta">${pids}${stid}${countMeta} · 개시일 ${escapeHtml(s.initiatedAt ?? '?')}</div>
      <div class="checks">${checks}</div>
      <div class="evidence">
        ${Object.entries(s.checks || {}).map(([k, c]) =>
          `<div><b>${labels[k]}</b>: ${escapeHtml(c.message || '')}</div>`
        ).join('')}
      </div>
    </div>
  `;
}

// ── 개시 후 정착 추적 (settle) ──────────────────────────────
const SETTLE_TYPE_LABEL = { failedConnection: '통신미연결', failedUsable: '사용불가', isError: '에러' };
const SETTLE_BUCKET_LABEL = { lt1h: '1h 미만', h1d24: '1h~24h', d1d7: '1~7일', gt7d: '7일+' };

async function loadSettle() {
  const el = document.getElementById('settle');
  if (!el || el.dataset.loaded) return; // 중복 호출 가드
  let d = null;
  try {
    const r = await fetch('/data/settle.json');
    if (r.ok) d = await r.json();
  } catch { /* 파일 없음 → 패널 숨김 */ }
  el.dataset.loaded = '1';
  if (!d) { el.innerHTML = ''; return; }
  renderSettle(el, d);
}

function renderSettle(el, d) {
  const err = d.error
    ? `<div class="settle-error">⚠️ 갱신 실패: ${escapeHtml(d.error.message)} — 마지막 성공: ${d.error.lastSuccessAt ? new Date(d.error.lastSuccessAt).toLocaleString('ko-KR') : '없음'} (아래는 직전 성공 데이터)</div>`
    : '';
  const items = d.items ?? [];
  const acc = d.accumulations;
  const diff = d.diff;
  const head = `
    <div class="slot-title">🩺 개시 후 정착 추적 (D+${d.windowDays ?? 30}) · 이상 ${items.length}건${
      diff ? ` · 신규 ↑${diff.newEntries.length} · 복구 ↓${diff.recovered.length}` : ''}${
      acc ? `<span class="settle-acc"> — 위젯 전체: 통신미연결 ${acc.failedConnection} · 사용불가 ${acc.failedUsable} · 에러 ${acc.isError}</span>` : ''}
    </div>
    <div class="meta">갱신: ${d.runAt ? new Date(d.runAt).toLocaleString('ko-KR') : '?'}${d.fetched?.truncated ? ' · ⚠️ 수집 상한 도달(일부 누락 가능)' : ''}</div>`;
  if (!items.length) {
    el.innerHTML = head + err + `<div class="meta">개시 ${d.windowDays ?? 30}일 이내 이상 충전기 없음 ✅</div>`;
    return;
  }
  const newSet = new Set(diff?.newEntries ?? []);
  const rows = items.map(i => `
    <tr class="${newSet.has(i.chargerId) ? 'settle-new' : ''}">
      <td>D+${i.dPlus}</td>
      <td>${i.stationId ? linkTag(stationUrl(i.stationId), escapeHtml(i.stationName ?? String(i.stationId))) : escapeHtml(i.stationName ?? '?')}</td>
      <td>${escapeHtml(String(i.chargerId))}${i.deviceId ? ` <span class="meta">${escapeHtml(i.deviceId)}</span>` : ''}</td>
      <td>${(i.types || []).map(t => `<span class="settle-badge ${t}">${SETTLE_TYPE_LABEL[t] ?? t}</span>`).join(' ')}</td>
      <td>${i.outageBucket ? escapeHtml(SETTLE_BUCKET_LABEL[i.outageBucket] ?? i.outageBucket) : '-'}${i.sharedModemRisk ? ' <span title="동일 회선(CTN) 공유 — 거점 동시단절 위험">⚠️공유회선</span>' : ''}</td>
      <td>${escapeHtml(i.launchedAt ?? '?')}</td>
      <td>${escapeHtml(i.errorCode ?? '')}</td>
    </tr>`).join('');
  const recoveredNote = diff?.recovered?.length
    ? `<div class="meta">복구됨(직전 대비): ${diff.recovered.map(r => escapeHtml(`${r.stationName ?? r.chargerId}(${r.chargerId})`)).join(', ')}</div>`
    : '';
  el.innerHTML = head + err + `
    <div class="settle-scroll"><table class="settle-table">
      <thead><tr><th>경과</th><th>충전소</th><th>충전기</th><th>이상 유형</th><th>두절 기간</th><th>개시일</th><th>에러코드</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${recoveredNote}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

init();
