const state = {
  manifest: null,
  current: null,
  slotData: { morning: null, evening: null },
  filterFailOnly: false
};

async function init() {
  try {
    const r = await fetch('/data/index.json');
    if (!r.ok) { renderEmpty(); return; }
    state.manifest = await r.json();
  } catch (e) {
    renderEmpty();
    return;
  }
  document.getElementById('last-updated').textContent =
    '마지막 갱신: ' + new Date(state.manifest.lastUpdated).toLocaleString('ko-KR');
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

function renderTomorrow() {
  const el = document.getElementById('slot-tomorrow');
  const evening = state.slotData.evening;
  const tomorrowStations = evening?.tomorrowStations || [];
  const tSummary = evening?.tomorrowSummary;
  if (!tSummary || tomorrowStations.length === 0) {
    el.innerHTML = '';
    return;
  }
  const tomorrowDate = tomorrowStations[0]?.initiatedAt || '';
  const labels = { doc: '📭 공문', rate: '💰 요금제', status: '⚙️ 통신상태' };
  let stations = tomorrowStations;
  if (state.filterFailOnly) stations = stations.filter(s => s.overall === 'FAIL' || s.overall === 'WARN');
  const byOverall = tSummary.byOverall;
  el.innerHTML = `
    <div class="slot-title">🌅 내일(${escapeHtml(tomorrowDate)}) 개시 예정 (${tomorrowStations.length}건)
      &nbsp;·&nbsp; PASS ${byOverall.PASS || 0} · WARN ${byOverall.WARN || 0} · FAIL ${byOverall.FAIL || 0} · SKIP ${byOverall.SKIP || 0}
    </div>
    ${stations.map(s => renderTomorrowCard(s, labels)).join('')}
  `;
  for (const c of el.querySelectorAll('.card')) {
    c.addEventListener('click', () => c.classList.toggle('expanded'));
  }
}

function renderTomorrowCard(s, labels) {
  const checks = Object.entries(s.checks || {}).map(([k, c]) =>
    `<span class="${c.status.toLowerCase()}">${labels[k] || k} ${c.status}</span>`
  ).join('');
  return `
    <div class="card ${(s.overall || 'SKIP').toLowerCase()}">
      <div><b>[${s.overall || 'SKIP'}]</b> ${escapeHtml(s.stationName ?? s.address ?? `proj:${s.projectId}`)}
        · ${escapeHtml(s.address || '')}
      </div>
      <div class="checks">${checks}</div>
      <div class="evidence">
        ${Object.entries(s.checks || {}).map(([k, c]) =>
          `<div><b>${labels[k] || k}</b>: ${escapeHtml(c.message || '')}</div>`
        ).join('')}
      </div>
    </div>
  `;
}

function renderSummary() {
  const both = ['morning', 'evening'].map(s => state.slotData[s]).filter(Boolean);
  const totals = both.reduce((acc, d) => {
    acc.totalStations += (d.summary.totalStations ?? d.summary.totalProjects ?? 0);
    for (const k of ['PASS', 'WARN', 'FAIL', 'SKIP']) acc.byOverall[k] += d.summary.byOverall[k] || 0;
    for (const ck of ['doc', 'rate', 'status', 'sheet']) {
      acc.byCheck[ck] = acc.byCheck[ck] || { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
      for (const st of ['PASS', 'WARN', 'FAIL', 'SKIP']) {
        acc.byCheck[ck][st] += d.summary.byCheck[ck]?.[st] || 0;
      }
    }
    return acc;
  }, { totalStations: 0, byOverall: { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 }, byCheck: {} });

  const checkLabels = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트' };
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
  const labels = { doc: '📭 공문', rate: '💰 요금제', status: '⚙️ 상태', sheet: '📊 시트' };
  const checks = Object.entries(s.checks || {}).map(([k, c]) =>
    `<span class="${c.status.toLowerCase()}">${labels[k]} ${c.status}</span>`
  ).join('');
  const name = s.stationName ?? s.projectName ?? s.stationId ?? '(no name)';
  const total = s.totalChargers ?? s.chargerCount ?? '?';
  const newCount = (s.newChargers || []).length;
  const addr = s.address ? ` · ${escapeHtml(s.address)}` : '';
  return `
    <div class="card ${(s.overall || 'skip').toLowerCase()}">
      <div><b>[${s.overall ?? 'SKIP'}]</b> ${escapeHtml(name)}${addr}</div>
      <div class="meta">총 ${escapeHtml(String(total))}기 · 신규 ${newCount}기 · 개시일 ${escapeHtml(s.initiatedAt ?? '?')}</div>
      <div class="checks">${checks}</div>
      <div class="evidence">
        ${Object.entries(s.checks || {}).map(([k, c]) =>
          `<div><b>${labels[k]}</b>: ${escapeHtml(c.message || '')}</div>`
        ).join('')}
      </div>
    </div>
  `;
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
