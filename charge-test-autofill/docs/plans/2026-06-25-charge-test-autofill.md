# 충전테스트 보완완료일자 자동 기입 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플링커넥트 티켓이 처리완료+이미지첨부면 그 완료일자를 시트 J열에 자동 기입하는, GitHub Actions cron(1일 2회) 기반 Node 자동화를 만든다.

**Architecture:** 순수 판정 로직(`lib/logic.js`)을 I/O(플링커넥트 API·구글시트·Slack)와 분리. `index.js`가 시트 읽기→대상행 필터→티켓 조회→판정→J열 쓰기→Slack 요약을 오케스트레이션. 1차 실행은 드라이런 강제.

**Tech Stack:** Node 20+ (ESM), `googleapis`(Sheets v4), Node 내장 `fetch`/`node:test`, `@slack/web-api`, `dotenv`.

## Global Constraints

- Node ESM(`"type":"module"`), Node ≥ 20.
- 시크릿은 환경변수로만 주입(하드코딩 금지): `PLINKCONNECT_USERNAME`, `PLINKCONNECT_PASSWORD`, `GOOGLE_SA_KEY`, `SLACK_BOT_TOKEN`, `NOTIFY_SLACK_USER_ID`.
- 대상 시트: `1uf9BmYEvT424rUOD9mpCheVkuBS_7xb9LOjM4aC57bY`, gid `619747296`, 탭명 `25년환경부_준공보완`.
- J열 = `OnM 보완완료일자`(출력, 0-base 인덱스 9). M열 = `25년환경부_준공보완_충전테스트`(입력, 0-base 인덱스 12).
- 데이터는 시트 2행부터 → 값배열 인덱스 i ↔ 시트 행 (i+2).
- 플링커넥트 API base `https://apis.pluglink.kr/v101`, 헤더 `x-channel:PLUGLINK / x-platform:WEB / x-token:PLUGLINK / Origin:https://connect.pluglink.kr`, 로그인 시 `x-token:1`.
- 기입 조건: `status==="COMPLETED"` AND 이미지 첨부 ≥1. 기입값은 `completedAt`의 날짜부(`YYYY-MM-DD`).
- J가 비어있을 때만 기입(덮어쓰기 금지). M이 `T-\d+` 아니면 스킵.
- 이미지 확장자: `.jpg .jpeg .png .gif .webp .heic .bmp` (대소문자 무시).

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`
- Create: `config/.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: npm 스크립트 `test`(`node --test`), `start`(`node index.js`); 의존성 `googleapis`, `@slack/web-api`, `dotenv`.

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "charge-test-autofill",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node index.js",
    "dry-run": "node index.js --dry-run",
    "test": "node --test"
  },
  "dependencies": {
    "@slack/web-api": "^7.0.0",
    "dotenv": "^17.0.0",
    "googleapis": "^144.0.0"
  }
}
```

- [ ] **Step 2: .gitignore 작성**

```
node_modules/
config/.env
*.log
```

- [ ] **Step 3: config/.env.example 작성**

```
PLINKCONNECT_USERNAME=woojung.kim@pluglink.kr
PLINKCONNECT_PASSWORD=
GOOGLE_SA_KEY=
SLACK_BOT_TOKEN=
NOTIFY_SLACK_USER_ID=
NOTIFY_SLACK_CHANNEL_ID=
SPREADSHEET_ID=1uf9BmYEvT424rUOD9mpCheVkuBS_7xb9LOjM4aC57bY
SHEET_GID=619747296
```

- [ ] **Step 4: 의존성 설치**

Run: `npm install`
Expected: node_modules 생성, 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore config/.env.example
git commit -m "chore: scaffold charge-test-autofill project"
```

---

### Task 2: 순수 판정 로직 + 단위테스트 (TDD)

**Files:**
- Create: `lib/logic.js`
- Test: `tests/logic.test.js`

**Interfaces:**
- Produces:
  - `extractTicketId(mCell: string): string | null` — `T-\d+`에서 숫자부 반환, 없으면 null.
  - `isImageFile(file: {name?:string,url?:string}): boolean`
  - `hasImage(files: object[]): boolean`
  - `toDateOnly(dt: string): string | null` — `"2026-01-22 00:00:00"`→`"2026-01-22"`, 형식 불명이면 null.
  - `decideWrite(ticket: {status,completedAt,files}): {ok:boolean, value?:string, reason:string}`
    - reason ∈ `"write" | "wait" | "no_image" | "bad_date"`.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/logic.test.js
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL (`../lib/logic.js` 모듈 없음).

- [ ] **Step 3: 최소 구현**

```javascript
// lib/logic.js
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp'];

export function extractTicketId(mCell) {
  if (!mCell || typeof mCell !== 'string') return null;
  const m = mCell.match(/\bT-(\d+)\b/i);
  return m ? m[1] : null;
}

export function isImageFile(file) {
  if (!file) return false;
  const s = String(file.name || file.url || '').toLowerCase();
  return IMAGE_EXT.some((ext) => s.endsWith(ext));
}

export function hasImage(files) {
  return Array.isArray(files) && files.some(isImageFile);
}

export function toDateOnly(dt) {
  if (!dt || typeof dt !== 'string') return null;
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function decideWrite(ticket) {
  if (!ticket || ticket.status !== 'COMPLETED') return { ok: false, reason: 'wait' };
  if (!hasImage(ticket.files)) return { ok: false, reason: 'no_image' };
  const value = toDateOnly(ticket.completedAt);
  if (!value) return { ok: false, reason: 'bad_date' };
  return { ok: true, value, reason: 'write' };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/logic.js tests/logic.test.js
git commit -m "feat: pure decision logic for autofill with unit tests"
```

---

### Task 3: 플링커넥트 API 클라이언트

**Files:**
- Create: `lib/pluglink.js`

**Interfaces:**
- Consumes: env `PLINKCONNECT_USERNAME`, `PLINKCONNECT_PASSWORD`.
- Produces:
  - `async login(): Promise<string>` — JWT 반환.
  - `async getTicket(jwt: string, id: string|number): Promise<object|null>` — 티켓 상세 `data` 또는 null.

- [ ] **Step 1: 구현 작성** (검증된 프로브 코드 기반)

```javascript
// lib/pluglink.js
const API_BASE = 'https://apis.pluglink.kr/v101';
const COMMON = {
  'x-channel': 'PLUGLINK', 'x-platform': 'WEB', 'x-token': 'PLUGLINK',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; ChargeTestAutofill/1.0)',
  Origin: 'https://connect.pluglink.kr',
};

async function apiFetch(url, { method = 'GET', body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...COMMON, ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

export async function login() {
  const username = process.env.PLINKCONNECT_USERNAME;
  const password = process.env.PLINKCONNECT_PASSWORD;
  if (!username || !password) throw new Error('PLINKCONNECT_USERNAME/PASSWORD 미설정');
  const r = await apiFetch(`${API_BASE}/auths/admins/signIn`, {
    method: 'POST',
    headers: { 'x-token': '1' },
    body: { email: username, password, authType: 'ORGANIC', partnerId: 1 },
  });
  const jwt = r?.data?.jwtToken;
  if (!jwt) throw new Error('로그인 응답에 jwtToken 없음');
  return jwt;
}

export async function getTicket(jwt, id) {
  try {
    const r = await apiFetch(`${API_BASE}/crms/tickets/${id}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    return r?.data ?? null;
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 2: 스모크 확인 (로컬, 실 자격증명 필요)**

Run: `node -e "import('./lib/pluglink.js').then(async m=>{const j=await m.login();const t=await m.getTicket(j,547438);console.log(t?.status,t?.completedAt,(t?.files||[]).length)})"`
Expected: `COMPLETED 2026-01-22 00:00:00 2`
(자격증명 미설정 시 이 스텝은 배포 직전 수행하고 통과 처리)

- [ ] **Step 3: Commit**

```bash
git add lib/pluglink.js
git commit -m "feat: pluglink api client (login + getTicket)"
```

---

### Task 4: 구글시트 읽기·쓰기 (googleapis)

**Files:**
- Create: `lib/sheets.js`

**Interfaces:**
- Consumes: env `GOOGLE_SA_KEY`(서비스계정 JSON 문자열).
- Produces:
  - `getSheetsClient(): sheets_v4.Sheets`
  - `async resolveTabTitle(sheets, spreadsheetId, gid): Promise<string>`
  - `async readTab(sheets, spreadsheetId, gid): Promise<string[][]>` — values(FORMATTED_VALUE).
  - `async writeCells(sheets, spreadsheetId, updates: {range:string, value:string}[]): Promise<void>` — batchUpdate.

- [ ] **Step 1: 구현 작성**

```javascript
// lib/sheets.js
import { google } from 'googleapis';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function getSheetsClient() {
  if (!process.env.GOOGLE_SA_KEY) throw new Error('GOOGLE_SA_KEY 미설정');
  const creds = JSON.parse(process.env.GOOGLE_SA_KEY);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [SHEETS_SCOPE],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function resolveTabTitle(sheets, spreadsheetId, gid) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });
  for (const s of meta.data.sheets || []) {
    if (String(s.properties.sheetId) === String(gid)) return s.properties.title;
  }
  throw new Error(`gid ${gid} 탭을 찾을 수 없음`);
}

export async function readTab(sheets, spreadsheetId, gid) {
  const title = await resolveTabTitle(sheets, spreadsheetId, gid);
  const range = `'${title.replace(/'/g, "''")}'`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return resp.data.values || [];
}

export async function writeCells(sheets, spreadsheetId, updates) {
  if (!updates.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/sheets.js
git commit -m "feat: google sheets read/write via service account"
```

---

### Task 5: Slack 요약 알림

**Files:**
- Create: `lib/notify.js`

**Interfaces:**
- Consumes: env `SLACK_BOT_TOKEN`, `NOTIFY_SLACK_USER_ID`, (옵션)`NOTIFY_SLACK_CHANNEL_ID`.
- Produces: `async sendSummary({written, waiting, noImage, errors, dryRun}): Promise<void>`
  - 각 인자는 `{station, ticketId, date?}` 객체 배열.

- [ ] **Step 1: 구현 작성**

```javascript
// lib/notify.js
import { WebClient } from '@slack/web-api';

export function buildSummaryText({ written, waiting, noImage, errors, dryRun }) {
  const tag = dryRun ? '[드라이런] ' : '';
  const lines = [`${tag}🔌 충전테스트 보완완료 자동기입 결과`];
  lines.push(`• J열 기입: *${written.length}건*  • 대기(미완료): ${waiting.length}건  • 이미지 미첨부: ${noImage.length}건  • 오류: ${errors.length}건`);
  if (written.length) {
    lines.push('\n*기입 상세*');
    for (const w of written) lines.push(`  ✅ ${w.station} (T-${w.ticketId}) → ${w.date}`);
  }
  if (noImage.length) {
    lines.push('\n*완료지만 이미지 미첨부(확인 필요)*');
    for (const n of noImage) lines.push(`  ⚠️ ${n.station} (T-${n.ticketId})`);
  }
  if (errors.length) {
    lines.push('\n*오류*');
    for (const e of errors) lines.push(`  🔴 ${e.station || '-'} (T-${e.ticketId}) ${e.reason || ''}`);
  }
  return lines.join('\n');
}

export async function sendSummary(summary) {
  const token = process.env.SLACK_BOT_TOKEN;
  const text = buildSummaryText(summary);
  if (!token || !process.env.NOTIFY_SLACK_USER_ID) {
    console.log('[notify] Slack 미설정 — 콘솔 출력만:\n' + text);
    return;
  }
  const client = new WebClient(token);
  await client.chat.postMessage({ channel: process.env.NOTIFY_SLACK_USER_ID, text });
  if (process.env.NOTIFY_SLACK_CHANNEL_ID) {
    await client.chat.postMessage({ channel: process.env.NOTIFY_SLACK_CHANNEL_ID, text });
  }
}
```

- [ ] **Step 2: buildSummaryText 단위테스트**

```javascript
// tests/notify.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryText } from '../lib/notify.js';

test('buildSummaryText: 건수/드라이런 태그', () => {
  const t = buildSummaryText({
    written: [{ station: '송추우리마을', ticketId: '547438', date: '2026-01-22' }],
    waiting: [], noImage: [], errors: [], dryRun: true,
  });
  assert.match(t, /\[드라이런\]/);
  assert.match(t, /J열 기입: \*1건\*/);
  assert.match(t, /송추우리마을 \(T-547438\) → 2026-01-22/);
});
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/notify.js tests/notify.test.js
git commit -m "feat: slack summary notification"
```

---

### Task 6: 오케스트레이터 index.js + 드라이런

**Files:**
- Create: `index.js`

**Interfaces:**
- Consumes: Task 2~5의 export 전부, env(Global Constraints).
- Produces: CLI 진입점. `--dry-run`이면 쓰기/Slack 발송 생략, 계획만 콘솔 출력.

- [ ] **Step 1: 구현 작성**

```javascript
// index.js
import 'dotenv/config';
import { extractTicketId, decideWrite } from './lib/logic.js';
import { login, getTicket } from './lib/pluglink.js';
import { getSheetsClient, readTab, writeCells, resolveTabTitle } from './lib/sheets.js';
import { sendSummary } from './lib/notify.js';

const J_COL = 9;   // 0-base: J = OnM 보완완료일자
const M_COL = 12;  // 0-base: M = 25년환경부_준공보완_충전테스트
const NAME_COL = 1; // B = PM 충전소명
const HEADER_ROWS = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const gid = process.env.SHEET_GID;
  console.log(`=== 충전테스트 자동기입 시작 ${dryRun ? '(DRY-RUN)' : ''} ===`);

  const sheets = getSheetsClient();
  const title = await resolveTabTitle(sheets, spreadsheetId, gid);
  const rows = await readTab(sheets, spreadsheetId, gid);

  // 대상행 필터: M=티켓ID 있고 J 비어있음
  const candidates = [];
  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    const mCell = row[M_COL] || '';
    const jCell = (row[J_COL] || '').trim();
    const ticketId = extractTicketId(mCell);
    if (!ticketId) continue;
    if (jCell) continue; // 이미 채워짐 → 보존
    candidates.push({ sheetRow: i + 1, ticketId, station: row[NAME_COL] || '-' });
  }
  console.log(`대상행 ${candidates.length}건 (M=티켓 & J 빈칸)`);

  const written = [], waiting = [], noImage = [], errors = [];
  const updates = [];
  let jwt = null;
  if (candidates.length) jwt = await login();

  for (const c of candidates) {
    const ticket = await getTicket(jwt, c.ticketId);
    if (!ticket) { errors.push({ ...c, reason: '티켓 조회 실패' }); continue; }
    const d = decideWrite(ticket);
    const station = ticket.targetStationName || c.station;
    if (d.reason === 'write') {
      updates.push({ range: `'${title.replace(/'/g, "''")}'!J${c.sheetRow}`, value: d.value });
      written.push({ ...c, station, date: d.value });
    } else if (d.reason === 'wait') {
      waiting.push({ ...c, station });
    } else if (d.reason === 'no_image') {
      noImage.push({ ...c, station });
    } else {
      errors.push({ ...c, station, reason: d.reason });
    }
    await sleep(200); // 레이트리밋 완화
  }

  console.log(`기입 ${written.length} / 대기 ${waiting.length} / 이미지없음 ${noImage.length} / 오류 ${errors.length}`);
  for (const w of written) console.log(`  WRITE J${w.sheetRow} = ${w.date}  (${w.station}, T-${w.ticketId})`);

  if (dryRun) {
    console.log('[DRY-RUN] 실제 쓰기/Slack 생략');
    return;
  }
  await writeCells(sheets, spreadsheetId, updates);
  const changed = written.length || noImage.length || errors.length;
  if (changed || process.argv.includes('--always-notify')) {
    await sendSummary({ written, waiting, noImage, errors, dryRun: false });
  }
  console.log('=== 완료 ===');
}

main().catch((e) => { console.error('치명적 오류:', e); process.exit(1); });
```

- [ ] **Step 2: 드라이런 실행 (실 자격증명 필요)**

Run: `npm run dry-run`
Expected: 후보행 목록 + "WRITE J{row} = YYYY-MM-DD". 알려진 행(347 송추우리마을, J347 이미 차있으면 후보서 제외됨에 유의 — 빈 J 행만). 쓰기/Slack 미발생.
(자격증명·SA키 미설정 시 배포 직전 수행)

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: orchestrator with dry-run"
```

---

### Task 7: GitHub Actions 워크플로 (cron 1일 2회)

**Files:**
- Create: `.github/workflows/autofill.yml`

**Interfaces:**
- Consumes: 저장소 Secrets — `PLINKCONNECT_USERNAME`, `PLINKCONNECT_PASSWORD`, `GOOGLE_SA_KEY`, `SLACK_BOT_TOKEN`, `NOTIFY_SLACK_USER_ID`(+옵션 `NOTIFY_SLACK_CHANNEL_ID`).

- [ ] **Step 1: 워크플로 작성**

```yaml
name: charge-test-autofill
on:
  schedule:
    - cron: '0 0 * * *'   # 09:00 KST
    - cron: '0 8 * * *'   # 17:00 KST
  workflow_dispatch:
    inputs:
      dry_run:
        description: '드라이런(쓰기 안 함)'
        type: boolean
        default: false
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Run autofill
        env:
          PLINKCONNECT_USERNAME: ${{ secrets.PLINKCONNECT_USERNAME }}
          PLINKCONNECT_PASSWORD: ${{ secrets.PLINKCONNECT_PASSWORD }}
          GOOGLE_SA_KEY: ${{ secrets.GOOGLE_SA_KEY }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          NOTIFY_SLACK_USER_ID: ${{ secrets.NOTIFY_SLACK_USER_ID }}
          NOTIFY_SLACK_CHANNEL_ID: ${{ secrets.NOTIFY_SLACK_CHANNEL_ID }}
          SPREADSHEET_ID: 1uf9BmYEvT424rUOD9mpCheVkuBS_7xb9LOjM4aC57bY
          SHEET_GID: '619747296'
        run: |
          if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then
            node index.js --dry-run
          else
            node index.js
          fi
```

- [ ] **Step 2: package-lock 생성 (npm ci 요건)**

Run: `npm install` (lock 없으면 생성)
Expected: `package-lock.json` 존재.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/autofill.yml package-lock.json
git commit -m "ci: github actions cron twice daily"
```

---

### Task 8: README + 배포 체크리스트

**Files:**
- Create: `README.md`

- [ ] **Step 1: README 작성** (배포 절차)

```markdown
# charge-test-autofill

플링커넥트 티켓(처리완료+이미지첨부) → 시트 J열(보완완료일자) 자동기입. GitHub Actions cron 1일 2회.

## 배포 체크리스트
1. 비공개 GitHub 저장소 생성 후 push.
2. 대상 시트를 서비스계정 client_email에 **편집자**로 공유.
3. 저장소 Settings→Secrets에 등록:
   PLINKCONNECT_USERNAME, PLINKCONNECT_PASSWORD, GOOGLE_SA_KEY,
   SLACK_BOT_TOKEN, NOTIFY_SLACK_USER_ID, (옵션)NOTIFY_SLACK_CHANNEL_ID
4. Actions → workflow_dispatch → dry_run=true 로 1회 검증.
5. dry_run=false 로 실주행, 시트·Slack 확인.

## 로컬
- `cp config/.env.example config/.env` 후 값 채우기
- `npm run dry-run` / `npm test`

## cron 시각
- 09:00, 17:00 KST (.github/workflows/autofill.yml). 변경 시 UTC 환산.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: readme + deploy checklist"
```

---

## Self-Review

- **Spec coverage:** 로직(T2)·플링커넥트(T3)·시트읽기쓰기(T4)·Slack(T5)·오케스트레이션+드라이런(T6)·cron 2회(T7)·배포준비(T8). 스펙 3~11 전 항목 매핑됨.
- **Placeholder scan:** 모든 스텝에 실제 코드/명령 포함. SA키 의존 스텝(T3-2,T6-2)은 "배포 직전 수행" 명시 — 자리표시자 아님.
- **Type consistency:** `decideWrite` reason 값(write/wait/no_image/bad_date)이 logic·index에서 일치. `extractTicketId` 반환(숫자문자열)이 `getTicket(id)`·Slack `T-${ticketId}`와 일치. J_COL=9/M_COL=12가 스펙 헤더매핑과 일치.
