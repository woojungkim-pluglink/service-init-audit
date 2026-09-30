const state = {
  manifest: null,
  current: null,
  slotData: { morning: null, evening: null },
  filterFailOnly: false,
  settleReq: 0   // 정착 추적 로드 순번 — 날짜를 빠르게 바꿀 때 늦게 도착한 옛 응답이 덮어쓰지 않게
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
    if (!r.ok) { loadSettle(null); renderEmpty(); return; }
    state.manifest = await r.json();
    // empty 마커(개시 없는 날 — 백업 cron dedup용)는 대시보드에 표시하지 않음
    state.manifest.slots = (state.manifest.slots || []).filter(s => s.file && !s.empty);
    state.manifest.settle = state.manifest.settle || [];
  } catch (e) {
    loadSettle(null);
    renderEmpty();
    return;
  }
  document.getElementById('last-updated').textContent =
    '마지막 갱신: ' + new Date(state.manifest.lastUpdated).toLocaleString('ko-KR');
  renderSidebar();
  // 개시가 없던 날도 정착 추적 스냅샷은 남으므로 목록·기본 선택은 두 원천의 합집합으로 잡는다
  const dates = sidebarDates().reverse();
  if (dates.length) await selectDate(dates[0]);
  else { renderEmpty(); loadSettle(null); }

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

/** 사이드바 날짜 = 개시 슬롯 날짜 ∪ 정착 추적 스냅샷 날짜 (개시 없는 날의 스냅샷도 볼 수 있게) */
function sidebarDates() {
  const m = state.manifest || {};
  return [...new Set([...(m.slots || []), ...(m.settle || [])].map(s => s.date))].sort();
}

const settleEntryOf = date => (state.manifest?.settle || []).find(s => s.date === date) || null;

function renderSidebar() {
  const ul = document.getElementById('date-list');
  ul.innerHTML = '';
  for (const d of sidebarDates().reverse()) {
    const slotsForDate = state.manifest.slots.filter(s => s.date === d);
    const se = settleEntryOf(d);
    const li = document.createElement('li');
    li.dataset.date = d;
    const settleDot = se
      ? `<span class="dot settle" title="정착 추적 스냅샷 · 이상 ${se.tracked ?? '?'}건"></span>` : '';
    li.innerHTML = `<span>${d}</span><span>${slotsForDate.map(s => `<span class="dot ${s.slot}"></span>`).join('')}${settleDot}</span>`;
    li.addEventListener('click', () => selectDate(d));
    ul.appendChild(li);
  }
}

async function selectDate(date) {
  state.current = date;
  for (const li of document.querySelectorAll('#date-list li')) {
    li.classList.toggle('active', li.dataset.date === date);
  }
  loadSettle(date); // 선택 날짜의 정착 추적 스냅샷 — 비동기 병행
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
  if (!both.length) {
    // 정착 추적 스냅샷만 있는 날 — 개시 알림이 없었던 날이다
    document.getElementById('summary').innerHTML = '이 날은 서비스개시 알림이 없었습니다. (아래 정착 추적 스냅샷만 있음)';
    return;
  }
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

/**
 * 선택 날짜의 정착 추적 스냅샷을 보여준다 (일별 보존본 `YYYY-MM-DD-settle.json`).
 *   - 그 날짜 스냅샷이 있으면 그것 (신규·복구는 전날 스냅샷 대비)
 *   - 없고 가장 최근 날짜면 최신본 settle.json (일별 보존 도입 전·첫 실행 전 대비)
 *   - 그 외 날짜는 '스냅샷 없음' — 최신 데이터를 옛 날짜 밑에 보여주면 오해를 부른다
 * @param {string|null} date null 이면 매니페스트 없이 최신본만 시도
 */
async function loadSettle(date) {
  const el = document.getElementById('settle');
  if (!el) return;
  const req = ++state.settleReq;
  const entry = date ? settleEntryOf(date) : null;
  const dates = state.manifest ? sidebarDates() : [];
  const isLatest = !date || date === dates[dates.length - 1];
  const file = entry ? entry.file : (isLatest ? 'settle.json' : null);

  if (!file) {
    const first = (state.manifest?.settle || [])[0]?.date;
    const since = first ? `일별 보존은 ${escapeHtml(first)} 부터` : '일별 보존 시작 전';
    el.innerHTML = `<div class="slot-title">🩺 개시 후 정착 추적</div>
      <div class="meta">${escapeHtml(date)} 의 정착 추적 스냅샷이 없습니다. (${since})</div>`;
    return;
  }
  let d = null;
  try {
    const r = await fetch('/data/' + file);
    if (r.ok) d = await r.json();
  } catch { /* 파일 없음 → 패널 숨김 */ }
  if (req !== state.settleReq) return; // 그 사이 다른 날짜가 선택됨 — 늦은 응답 폐기
  if (!d) { el.innerHTML = ''; return; }
  renderSettle(el, d, { snapshotDate: entry ? date : null });
}

function renderSettle(el, d, { snapshotDate = null } = {}) {
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
    <div class="meta">${snapshotDate ? `📌 ${escapeHtml(snapshotDate)} 스냅샷 · ` : '최신본 · '}갱신: ${d.runAt ? new Date(d.runAt).toLocaleString('ko-KR') : '?'}${
      diff ? ` · 신규·복구 비교 기준: ${/^\d{4}-\d{2}-\d{2}$/.test(d.diffBase ?? '') ? `${escapeHtml(d.diffBase)} 스냅샷` : '직전 실행'}` : ''}${
      d.fetched?.truncated ? ' · ⚠️ 수집 상한 도달(일부 누락 가능)' : ''}</div>`;
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
