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
  document.getElementById('main').innerHTML =
    '<div style="padding: 40px; color: #888;">아직 검증 데이터가 없습니다.</div>';
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
  const r = await fetch('/data/' + entry.file);
  return r.json();
}

function renderBody() {
  document.getElementById('header').textContent = `${state.current}`;
  renderSummary();
  renderSlot('morning', '아침(8AM 알림)');
  renderSlot('evening', '저녁(5PM 알림)');
}

function renderSummary() {
  const both = ['morning', 'evening'].map(s => state.slotData[s]).filter(Boolean);
  const totals = both.reduce((acc, d) => {
    acc.totalProjects += d.summary.totalProjects;
    for (const k of ['PASS', 'WARN', 'FAIL', 'SKIP']) acc.byOverall[k] += d.summary.byOverall[k] || 0;
    for (const ck of ['doc', 'rate', 'status', 'sheet']) {
      acc.byCheck[ck] = acc.byCheck[ck] || { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
      for (const st of ['PASS', 'WARN', 'FAIL', 'SKIP']) {
        acc.byCheck[ck][st] += d.summary.byCheck[ck]?.[st] || 0;
      }
    }
    return acc;
  }, { totalProjects: 0, byOverall: { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 }, byCheck: {} });

  const checkLabels = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트' };
  document.getElementById('summary').innerHTML = `
    총 ${totals.totalProjects}건 · PASS ${totals.byOverall.PASS} · WARN ${totals.byOverall.WARN} · FAIL ${totals.byOverall.FAIL}
    <br>${Object.keys(checkLabels).map(k => `${checkLabels[k]} ${totals.byCheck[k]?.PASS || 0}/${totals.totalProjects}`).join(' · ')}
  `;
}

function renderSlot(slot, title) {
  const el = document.getElementById('slot-' + slot);
  const data = state.slotData[slot];
  if (!data) { el.innerHTML = `<div class="slot-title">${title} — 데이터 없음</div>`; return; }
  let projects = data.projects;
  if (state.filterFailOnly) projects = projects.filter(p => p.overall === 'FAIL' || p.overall === 'WARN');

  el.innerHTML = `<div class="slot-title">${title} (${projects.length}건)</div>` +
    projects.map(renderCard).join('');
  for (const c of el.querySelectorAll('.card')) {
    c.addEventListener('click', () => c.classList.toggle('expanded'));
  }
}

function renderCard(p) {
  const labels = { doc: '📭 공문', rate: '💰 요금제', status: '⚙️ 상태', sheet: '📊 시트' };
  const checks = Object.entries(p.checks).map(([k, c]) =>
    `<span class="${c.status.toLowerCase()}">${labels[k]} ${c.status}</span>`
  ).join('');
  return `
    <div class="card ${p.overall.toLowerCase()}">
      <div><b>[${p.overall}]</b> ${escapeHtml(p.projectName)} · 서비스개시일 ${escapeHtml(p.initiatedAt)} · 충전기 ${escapeHtml(String(p.chargerCount))}대</div>
      <div class="checks">${checks}</div>
      <div class="evidence">
        ${Object.entries(p.checks).map(([k, c]) =>
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
