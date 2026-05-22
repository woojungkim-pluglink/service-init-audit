# 서비스개시 검증 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플링커넥트 서비스개시 충전기에 대해 4가지(공문/요금제/상태/시트)를 매일 08:30·17:30 자동 검증해 Vercel 정적 대시보드 + Slack DM으로 제공.

**Architecture:** 단일 진입점 `audit.js`가 4개 체커 모듈을 호출 → JSON 산출 → git push → Vercel 정적 배포. Windows 작업 스케줄러로 사용자 PC에서 실행. Playwright 세션 1개를 모듈들이 공유.

**Tech Stack:** Node.js v24+, Playwright(기존 chrome_profile 재사용), Node 내장 `node:test`, Vanilla HTML/JS(빌드 없음), Vercel 정적 호스팅, mcp__scheduled-tasks(Windows 작업 스케줄러).

**Spec:** `docs/superpowers/specs/2026-05-22-service-init-audit-dashboard-design.md`

**작업 폴더:** `C:/Users/user/Documents/claude/service-init-audit/`

---

## File Structure

```
service-init-audit/
├── audit.js                          # 진입점, 4개 체커 오케스트레이션
├── lib/
│   ├── discover.js                   # 슬랙 → projectId 목록
│   ├── playwright_session.js         # connect.pluglink.kr 세션 관리
│   ├── check_doc.js                  # Gmail cc 검색
│   ├── check_rate.js                 # 요금제 3단 매칭
│   ├── check_status.js               # 충전소 하단 상태
│   ├── check_sheet.js                # 영차영차 BR열
│   ├── notify.js                     # Slack DM 요약
│   ├── manifest.js                   # data/index.json 갱신
│   └── retention.js                  # 90일 보관 정리
├── tests/
│   ├── fixtures/                     # 모든 모듈 fixture
│   │   ├── slack_messages.json
│   │   ├── gmail_threads.json
│   │   ├── plinkconnect_contract.html
│   │   ├── plinkconnect_rate_detail.html
│   │   ├── plinkconnect_station_chargers.html
│   │   └── sheet_gviz.csv
│   ├── test_discover.js
│   ├── test_check_doc.js
│   ├── test_check_rate.js
│   ├── test_check_status.js
│   ├── test_check_sheet.js
│   ├── test_manifest.js
│   └── test_retention.js
├── config/
│   ├── pm_emails.json
│   └── .env.example
├── data/
│   └── (런타임에 JSON 생성)
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── chrome_profile/                   # gitignore
├── logs/                             # gitignore
├── .gitignore
├── package.json
├── vercel.json
└── README.md
```

각 파일 책임:
- `audit.js` — CLI 파싱, Playwright 1개 인스턴스 생성, 체커 순회, JSON 저장, git push, notify 호출
- `lib/discover.js` — Slack `conversations.history` 호출 후 메시지에서 충전소 링크/projectId 추출
- `lib/playwright_session.js` — `chrome_profile/` 디렉토리로 영구 컨텍스트 시작, 로그인 만료 시 throw
- `lib/check_*.js` — `async (project, ctx) => CheckResult` 시그니처. ctx에 playwright page, env 포함
- `lib/notify.js` — `chat.postMessage`로 DM 발송. `dryRun` 옵션 시 stdout만
- `lib/manifest.js` — `data/index.json`에 새 슬롯 append, 90일 윈도우 유지
- `lib/retention.js` — `data/*.json` 중 90일 초과 파일 삭제
- `public/*` — 정적 대시보드 (Vanilla)

---

## 검증 명령어 일람

| 목적 | 명령 |
|---|---|
| 단일 테스트 | `node --test tests/test_discover.js` |
| 전체 테스트 | `node --test tests/` |
| 진입점 dry-run | `node audit.js --slot=morning --dry-run` |
| 매니페스트 확인 | `cat data/index.json` |

---

## Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `service-init-audit/package.json`
- Create: `service-init-audit/.gitignore`
- Create: `service-init-audit/README.md`
- Create: `service-init-audit/vercel.json`

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "service-init-audit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "audit": "node audit.js",
    "test": "node --test tests/",
    "deploy": "vercel --prod"
  },
  "dependencies": {
    "playwright": "^1.47.0",
    "@slack/web-api": "^7.0.0",
    "googleapis": "^144.0.0"
  }
}
```

Run: `cd "C:/Users/user/Documents/claude/service-init-audit" && npm install`
Expected: `node_modules/` 생성, 에러 없음

- [ ] **Step 2: .gitignore 생성**

```
node_modules/
chrome_profile/
logs/
data/*.json
!data/index.json
config/.env
.vercel/
```

- [ ] **Step 3: vercel.json 생성**

```json
{
  "buildCommand": "",
  "outputDirectory": "public",
  "framework": null,
  "rewrites": [
    { "source": "/data/(.*)", "destination": "/data/$1" }
  ]
}
```

추가: `vercel.json`의 `includeFiles`로 `data/` 포함되게 하려면 `vercel.json`을 다음처럼:

```json
{
  "buildCommand": "node scripts/copy_data_to_public.js",
  "outputDirectory": "public",
  "framework": null
}
```

`scripts/copy_data_to_public.js`:
```javascript
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/data', { recursive: true });
cpSync('data', 'public/data', { recursive: true });
console.log('data/ copied to public/data/');
```

- [ ] **Step 4: README.md 생성**

```markdown
# service-init-audit

플링커넥트 서비스개시 충전기 4종 자동 검증.
- 설계: docs/superpowers/specs/2026-05-22-service-init-audit-dashboard-design.md
- 실행: `node audit.js --slot=morning|evening`
- 테스트: `node --test tests/`
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore vercel.json README.md scripts/
git commit -m "chore: scaffold service-init-audit project"
```

---

## Task 2: 설정 파일

**Files:**
- Create: `config/pm_emails.json`
- Create: `config/.env.example`

- [ ] **Step 1: pm_emails.json 작성**

```json
{
  "양대열": { "nickname": "체셔",   "email": "daeyeol.yang@pluglink.kr" },
  "김택윤": { "nickname": "윤택",   "email": "taekyoon.kim@pluglink.kr" },
  "김충근": { "nickname": "케이시", "email": "chunggeun.kim@pluglink.kr" }
}
```

- [ ] **Step 2: .env.example 작성**

```
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C026XGZE1GT
NOTIFY_SLACK_USER_ID=Uxxxxxxxx

# Gmail (OAuth2)
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_USER=woojung.kim@pluglink.kr

# Google Sheets (cookies로 gviz 호출용)
SHEET_GVIZ_COOKIE=

# Plinkconnect
PLINKCONNECT_BASE=https://connect.pluglink.kr
CHROME_PROFILE_DIR=./chrome_profile

# Dashboard
DATA_RETENTION_DAYS=90
```

- [ ] **Step 3: Commit**

```bash
git add config/
git commit -m "chore: add config templates"
```

---

## Task 3: discover.js — 슬랙 메시지 → projectId 목록 (TDD)

**Files:**
- Create: `tests/fixtures/slack_messages.json`
- Create: `tests/test_discover.js`
- Create: `lib/discover.js`

- [ ] **Step 1: fixture 생성** `tests/fixtures/slack_messages.json`

```json
{
  "ok": true,
  "messages": [
    {
      "ts": "1779404445.913559",
      "type": "message",
      "text": "[서비스개시] OO아파트 지하주차장\n충전소: <https://connect.pluglink.kr/stations/12345|OO아파트>\n프로젝트: <https://connect.pluglink.kr/projects/abc-uuid|OO아파트 프로젝트>\n충전기 4대"
    },
    {
      "ts": "1779404500.000000",
      "type": "message",
      "text": "[서비스개시] XX빌라\n충전소: https://connect.pluglink.kr/stations/67890\n프로젝트: https://connect.pluglink.kr/projects/def-uuid\n충전기 2대"
    },
    {
      "ts": "1779404600.000000",
      "type": "message",
      "subtype": "channel_join",
      "text": "user joined the channel"
    }
  ]
}
```

- [ ] **Step 2: 테스트 작성** `tests/test_discover.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlackMessages } from '../lib/discover.js';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/slack_messages.json', import.meta.url)));

test('parseSlackMessages: 마크다운 링크 형식에서 stationId/projectId 추출', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result.length, 2);
  assert.equal(result[0].stationId, '12345');
  assert.equal(result[0].projectId, 'abc-uuid');
  assert.equal(result[0].ts, '1779404445.913559');
  assert.match(result[0].permalink, /p1779404445913559$/);
});

test('parseSlackMessages: 평문 URL 형식에서도 추출', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result[1].stationId, '67890');
  assert.equal(result[1].projectId, 'def-uuid');
});

test('parseSlackMessages: subtype 있는 메시지(채널 입장 등) 제외', () => {
  const result = parseSlackMessages(fixture.messages);
  assert.equal(result.find(r => r.ts === '1779404600.000000'), undefined);
});

test('parseSlackMessages: 충전소 링크 없는 메시지는 제외', () => {
  const noLink = [{ ts: '1.0', type: 'message', text: '점심 어디서 먹지' }];
  assert.equal(parseSlackMessages(noLink).length, 0);
});
```

- [ ] **Step 3: 테스트 실행 (FAIL 확인)**

Run: `node --test tests/test_discover.js`
Expected: 모듈을 찾을 수 없다는 에러 또는 함수 undefined

- [ ] **Step 4: 구현** `lib/discover.js`

```javascript
import { WebClient } from '@slack/web-api';

const STATION_RE = /connect\.pluglink\.kr\/stations\/([A-Za-z0-9-]+)/;
const PROJECT_RE = /connect\.pluglink\.kr\/projects\/([A-Za-z0-9-]+)/;

export function parseSlackMessages(messages, channelId = 'C026XGZE1GT') {
  const out = [];
  for (const m of messages) {
    if (m.subtype) continue;
    if (!m.text) continue;
    const sm = m.text.match(STATION_RE);
    const pm = m.text.match(PROJECT_RE);
    if (!sm || !pm) continue;
    const tsForPermalink = m.ts.replace('.', '');
    out.push({
      ts: m.ts,
      permalink: `https://pluglink.slack.com/archives/${channelId}/p${tsForPermalink}`,
      stationId: sm[1],
      projectId: pm[1],
      rawText: m.text
    });
  }
  return out;
}

/**
 * 슬롯의 시각 범위에 해당하는 메시지를 가져와서 파싱.
 * @param {object} opts { slot: 'morning'|'evening', date: 'YYYY-MM-DD', token, channelId }
 */
export async function discoverProjects({ slot, date, token, channelId }) {
  const client = new WebClient(token);
  const baseDate = new Date(`${date}T00:00:00+09:00`);
  const window = slot === 'morning'
    ? { start: '07:30', end: '09:00' }
    : { start: '16:30', end: '18:00' };
  const oldest = new Date(`${date}T${window.start}:00+09:00`).getTime() / 1000;
  const latest = new Date(`${date}T${window.end}:00+09:00`).getTime() / 1000;

  const resp = await client.conversations.history({
    channel: channelId,
    oldest: String(oldest),
    latest: String(latest),
    inclusive: true,
    limit: 200
  });
  if (!resp.ok) throw new Error(`slack history failed: ${resp.error}`);
  return parseSlackMessages(resp.messages || [], channelId);
}
```

- [ ] **Step 5: 테스트 실행 (PASS)**

Run: `node --test tests/test_discover.js`
Expected: 4/4 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/discover.js tests/test_discover.js tests/fixtures/slack_messages.json
git commit -m "feat(discover): parse slack messages for station/project ids"
```

---

## Task 4: playwright_session.js — 세션 매니저

**Files:**
- Create: `lib/playwright_session.js`

플레이라이트는 외부 의존성이 강해 단위 테스트가 어려움 → 통합 테스트로 후속 task에서 검증.

- [ ] **Step 1: 구현** `lib/playwright_session.js`

```javascript
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';

let _ctx = null;

export async function openSession({ profileDir, headless = true }) {
  if (_ctx) return _ctx;
  const abs = path.resolve(profileDir);
  if (!existsSync(abs)) {
    throw new Error(`chrome_profile not found at ${abs}. Run pluglink-connect-login first.`);
  }
  _ctx = await chromium.launchPersistentContext(abs, {
    headless,
    viewport: { width: 1440, height: 900 }
  });
  return _ctx;
}

export async function closeSession() {
  if (_ctx) { await _ctx.close(); _ctx = null; }
}

/**
 * 로그인 만료 감지 — 어떤 페이지든 /login으로 redirect되면 throw
 */
export async function assertLoggedIn(page) {
  if (/\/login(\?|$)/.test(page.url())) {
    throw new Error('PLINKCONNECT_LOGIN_EXPIRED');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/playwright_session.js
git commit -m "feat(session): playwright persistent context manager"
```

---

## Task 5: check_doc.js — Gmail cc 검색 (TDD)

**Files:**
- Create: `tests/fixtures/gmail_threads.json`
- Create: `tests/test_check_doc.js`
- Create: `lib/check_doc.js`

- [ ] **Step 1: fixture** `tests/fixtures/gmail_threads.json`

```json
{
  "threads": [
    {
      "id": "t1",
      "subject": "[플러그링크] OO아파트 충전기 설치 안내",
      "from": "daeyeol.yang@pluglink.kr",
      "to": ["관리사무소@ooapt.com"],
      "cc": ["woojung.kim@pluglink.kr"],
      "date": "2026-05-20T14:00:00+09:00",
      "snippet": "OO아파트 지하주차장 충전기 4대 설치가 완료되어..."
    },
    {
      "id": "t2",
      "subject": "ZZ아파트 견적 문의",
      "from": "daeyeol.yang@pluglink.kr",
      "to": ["zzapt@xxx.com"],
      "cc": [],
      "date": "2026-05-19T11:00:00+09:00",
      "snippet": "ZZ아파트 견적서 첨부드립니다"
    }
  ]
}
```

- [ ] **Step 2: 테스트** `tests/test_check_doc.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEmails } from '../lib/check_doc.js';
import { readFileSync } from 'node:fs';

const { threads } = JSON.parse(readFileSync(new URL('./fixtures/gmail_threads.json', import.meta.url)));
const pmEmails = ['daeyeol.yang@pluglink.kr', 'taekyoon.kim@pluglink.kr', 'chunggeun.kim@pluglink.kr'];

test('matchEmails: PASS — cc:woojung 매칭 메일 발견', () => {
  const r = matchEmails(threads, {
    keywords: ['OO아파트', 'OO아파트 지하주차장'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.evidence.matchedEmails.length, 1);
  assert.equal(r.evidence.matchedEmails[0].id, 't1');
});

test('matchEmails: WARN — PM 발신 메일 있지만 cc:me 빠짐', () => {
  const r = matchEmails(threads, {
    keywords: ['ZZ아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'WARN');
});

test('matchEmails: FAIL — 매칭 메일 없음', () => {
  const r = matchEmails(threads, {
    keywords: ['QQ아파트'],
    pmEmails,
    myEmail: 'woojung.kim@pluglink.kr'
  });
  assert.equal(r.status, 'FAIL');
});
```

- [ ] **Step 3: 테스트 실행 (FAIL)**

Run: `node --test tests/test_check_doc.js`

- [ ] **Step 4: 구현** `lib/check_doc.js`

```javascript
import { google } from 'googleapis';

export function matchEmails(threads, { keywords, pmEmails, myEmail }) {
  const pmSet = new Set(pmEmails);
  const myEmailLower = myEmail.toLowerCase();

  const fromPM = threads.filter(t => pmSet.has(t.from.toLowerCase()));
  const matchedKeyword = (t) => keywords.some(k =>
    (t.subject || '').includes(k) || (t.snippet || '').includes(k)
  );

  const withCC = fromPM.filter(t =>
    (t.cc || []).some(c => c.toLowerCase() === myEmailLower) && matchedKeyword(t)
  );

  if (withCC.length >= 1) {
    return {
      status: 'PASS',
      evidence: {
        matchedEmails: withCC.map(t => ({
          id: t.id, subject: t.subject, from: t.from,
          to: t.to, cc: t.cc, date: t.date,
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${t.id}`
        })),
        queriedKeywords: keywords
      },
      message: `PM ${withCC[0].from.split('@')[0]} 발송 (cc 확인), ${withCC.length}건`
    };
  }

  const withoutCC = fromPM.filter(matchedKeyword);
  if (withoutCC.length >= 1) {
    return {
      status: 'WARN',
      evidence: { matchedEmails: withoutCC.map(t => ({ id: t.id, subject: t.subject, from: t.from, date: t.date })), queriedKeywords: keywords },
      message: `PM 발송 있으나 cc 참조 없음 (${withoutCC.length}건)`
    };
  }

  return {
    status: 'FAIL',
    evidence: { matchedEmails: [], queriedKeywords: keywords },
    message: 'PM 발송 메일을 찾지 못함'
  };
}

/**
 * 실제 Gmail에서 스레드 가져오기.
 */
export async function fetchGmailThreads({ oauth2Client, pmEmails, sinceDate }) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const fromQuery = pmEmails.map(e => `from:${e}`).join(' OR ');
  const q = `(${fromQuery}) cc:me after:${sinceDate.replace(/-/g, '/')}`;
  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100 });
  const messages = res.data.messages || [];
  const detailed = [];
  for (const m of messages) {
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date'] });
    const headers = Object.fromEntries((full.data.payload.headers || []).map(h => [h.name, h.value]));
    detailed.push({
      id: m.id,
      subject: headers.Subject || '',
      from: (headers.From || '').match(/<([^>]+)>/)?.[1] || headers.From || '',
      to: (headers.To || '').split(',').map(s => s.trim()),
      cc: (headers.Cc || '').split(',').filter(Boolean).map(s => s.trim()),
      date: headers.Date,
      snippet: full.data.snippet
    });
  }
  return detailed;
}

export async function checkDoc(project, ctx) {
  const sinceDate = subtractDays(project.initiatedAt, 30);
  const threads = await fetchGmailThreads({
    oauth2Client: ctx.gmail,
    pmEmails: ctx.pmEmails,
    sinceDate
  });
  return matchEmails(threads, {
    keywords: [project.projectName, project.stationName].filter(Boolean),
    pmEmails: ctx.pmEmails,
    myEmail: ctx.myEmail
  });
}

function subtractDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 5: 테스트 실행 (PASS)**

Run: `node --test tests/test_check_doc.js`
Expected: 3/3 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/check_doc.js tests/test_check_doc.js tests/fixtures/gmail_threads.json
git commit -m "feat(check_doc): gmail cc-match verification"
```

---

## Task 6: check_rate.js — 요금제 3단 매칭 (TDD)

**Files:**
- Create: `tests/fixtures/plinkconnect_contract.html` (수동 캡처 후 보강 가능)
- Create: `tests/fixtures/plinkconnect_rate_detail.html`
- Create: `tests/test_check_rate.js`
- Create: `lib/check_rate.js`

플링커넥트 페이지 셀렉터는 **첫 실행 시점에 사용자와 함께 확정** (스펙 14장). Plan에서는 **함수 시그니처와 판정 로직만** TDD로 다지고, 셀렉터는 placeholder 함수로 분리.

- [ ] **Step 1: fixture** `tests/fixtures/plinkconnect_contract.html`

```html
<html><body>
  <div class="contract-tab">
    <div class="rate-name">특가-기본료포함-A</div>
    <div class="attachments">
      <a href="/files/agreement.pdf">합의서.pdf</a>
    </div>
  </div>
</body></html>
```

`tests/fixtures/plinkconnect_rate_detail.html`:
```html
<html><body>
  <table class="rate-detail">
    <tr><td>DEV001</td></tr>
    <tr><td>DEV002</td></tr>
    <tr><td>DEV003</td></tr>
    <tr><td>DEV004</td></tr>
  </table>
</body></html>
```

`tests/fixtures/plinkconnect_init_tab.html`:
```html
<html><body>
  <table class="init-chargers">
    <tr><td>DEV001</td></tr>
    <tr><td>DEV002</td></tr>
    <tr><td>DEV003</td></tr>
    <tr><td>DEV004</td></tr>
  </table>
</body></html>
```

- [ ] **Step 2: 테스트** `tests/test_check_rate.js`

```javascript
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
```

- [ ] **Step 3: 테스트 실행 (FAIL)**

Run: `node --test tests/test_check_rate.js`

- [ ] **Step 4: 구현** `lib/check_rate.js`

```javascript
import { assertLoggedIn } from './playwright_session.js';

/**
 * 순수 판정 함수 (테스트 대상)
 */
export function judgeRate({ contractRateName, hasSpecialAgreementFile, appliedChargers, projectChargers }) {
  const isSpecial = /특가/.test(contractRateName);
  const aSet = new Set(appliedChargers);
  const pSet = new Set(projectChargers);
  const diff = [
    ...projectChargers.filter(d => !aSet.has(d)),
    ...appliedChargers.filter(d => !pSet.has(d))
  ];

  const evidence = { contractRateName, hasSpecialAgreementFile, appliedChargers, projectChargers, diff };

  if (isSpecial && !hasSpecialAgreementFile) {
    return { status: 'FAIL', evidence, message: '특가요금이지만 합의서 파일 없음' };
  }
  if (diff.length > 0) {
    return { status: 'FAIL', evidence, message: `요금제 적용 충전기 불일치 (${diff.length}대)` };
  }
  return { status: 'PASS', evidence, message: `${projectChargers.length}/${projectChargers.length} 매칭${isSpecial ? ', 특가합의서 확인' : ''}` };
}

/**
 * 플링커넥트 페이지 스크래핑. 셀렉터는 첫 실행 시 사용자와 확정.
 * @param {object} project
 * @param {object} ctx { browserContext, plinkconnectBase }
 */
export async function checkRate(project, ctx) {
  const { browserContext, plinkconnectBase } = ctx;
  const page = await browserContext.newPage();
  try {
    // 1) 계약탭
    await page.goto(`${plinkconnectBase}/projects/${project.projectId}?tab=contract`);
    await assertLoggedIn(page);
    const contractRateName = await page.locator('[data-test="rate-name"]').textContent({ timeout: 10000 }).then(t => t.trim());
    const hasSpecialAgreementFile = await page.locator('[data-test="attachments"] a[href$=".pdf"], [data-test="attachments"] a[href$=".png"], [data-test="attachments"] a[href$=".jpg"]').count().then(n => n > 0);

    // 2) 충전소 요금제탭
    await page.goto(`${plinkconnectBase}/stations/${project.stationId}?tab=rate`);
    await page.getByText(contractRateName).locator('xpath=ancestor::*[contains(@data-test,"rate-row")]//button[contains(., "자세히")]').click();
    await page.waitForSelector('[data-test="rate-detail-row"]');
    const appliedChargers = await page.locator('[data-test="rate-detail-row"]').allTextContents();

    // 3) 프로젝트 서비스개시 탭
    await page.goto(`${plinkconnectBase}/projects/${project.projectId}?tab=init`);
    await page.waitForSelector('[data-test="init-charger-row"]');
    const projectChargers = await page.locator('[data-test="init-charger-row"]').allTextContents();

    return judgeRate({
      contractRateName,
      hasSpecialAgreementFile,
      appliedChargers: appliedChargers.map(s => s.trim()),
      projectChargers: projectChargers.map(s => s.trim())
    });
  } catch (e) {
    if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    return {
      status: 'SKIP',
      evidence: { error: e.message },
      message: `요금제 검증 실패: ${e.message.slice(0, 100)}`
    };
  } finally {
    await page.close();
  }
}
```

> **참고:** `[data-test="..."]` 셀렉터는 placeholder. **Task 16 첫 실행 검증 시점에 실제 DOM을 확인하여 수정한다.** 판정 로직(judgeRate)은 셀렉터와 분리되어 있어 셀렉터 변경이 테스트에 영향 없음.

- [ ] **Step 5: 테스트 실행 (PASS)**

Run: `node --test tests/test_check_rate.js`
Expected: 4/4 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/check_rate.js tests/test_check_rate.js tests/fixtures/plinkconnect_*.html
git commit -m "feat(check_rate): 3-way rate matching + special agreement check"
```

---

## Task 7: check_status.js — 충전기 상태 (TDD)

**Files:**
- Create: `tests/fixtures/plinkconnect_station_chargers.html`
- Create: `tests/test_check_status.js`
- Create: `lib/check_status.js`

- [ ] **Step 1: fixture** `tests/fixtures/plinkconnect_station_chargers.html`

```html
<html><body>
  <table data-test="charger-status-table">
    <tr data-test="charger-row"><td>DEV001</td><td>사업개시</td><td>운영</td><td>사용가능</td></tr>
    <tr data-test="charger-row"><td>DEV002</td><td>사업개시</td><td>운영</td><td>점검중</td></tr>
    <tr data-test="charger-row"><td>DEV003</td><td>사업개시</td><td>운영</td><td>사용가능</td></tr>
  </table>
</body></html>
```

- [ ] **Step 2: 테스트** `tests/test_check_status.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeStatus } from '../lib/check_status.js';

test('judgeStatus: PASS — 모두 정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '사업개시', operationStatus: '운영', useStatus: '사용가능' }
  ]);
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.evidence.abnormal, []);
});

test('judgeStatus: WARN — 일부 비정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '사업개시', operationStatus: '운영', useStatus: '사용가능' },
    { deviceId: 'DEV002', businessStatus: '사업개시', operationStatus: '운영', useStatus: '점검중' }
  ]);
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.evidence.abnormal, ['DEV002']);
});

test('judgeStatus: FAIL — 전부 비정상', () => {
  const r = judgeStatus([
    { deviceId: 'DEV001', businessStatus: '미개시', operationStatus: '대기', useStatus: '사용불가' }
  ]);
  assert.equal(r.status, 'FAIL');
});

test('judgeStatus: SKIP — 빈 입력', () => {
  const r = judgeStatus([]);
  assert.equal(r.status, 'SKIP');
});
```

- [ ] **Step 3: 테스트 실행 (FAIL)**

Run: `node --test tests/test_check_status.js`

- [ ] **Step 4: 구현** `lib/check_status.js`

```javascript
import { assertLoggedIn } from './playwright_session.js';

const isNormal = (c) =>
  c.businessStatus === '사업개시' &&
  c.operationStatus === '운영' &&
  c.useStatus === '사용가능';

export function judgeStatus(chargers) {
  if (!chargers || chargers.length === 0) {
    return { status: 'SKIP', evidence: { chargers: [], abnormal: [] }, message: '충전기 정보 없음' };
  }
  const abnormal = chargers.filter(c => !isNormal(c)).map(c => c.deviceId);
  if (abnormal.length === 0) {
    return { status: 'PASS', evidence: { chargers, abnormal: [] }, message: `${chargers.length}대 모두 정상` };
  }
  if (abnormal.length < chargers.length) {
    return { status: 'WARN', evidence: { chargers, abnormal }, message: `${abnormal.length}/${chargers.length}대 비정상` };
  }
  return { status: 'FAIL', evidence: { chargers, abnormal }, message: '전 충전기 비정상' };
}

export async function checkStatus(project, ctx) {
  const { browserContext, plinkconnectBase } = ctx;
  const page = await browserContext.newPage();
  try {
    await page.goto(`${plinkconnectBase}/stations/${project.stationId}`);
    await assertLoggedIn(page);
    await page.waitForSelector('[data-test="charger-row"]');
    const rows = await page.$$('[data-test="charger-row"]');
    const chargers = [];
    for (const row of rows) {
      const cells = await row.$$eval('td', tds => tds.map(t => t.textContent.trim()));
      // 셀 순서: deviceId, businessStatus, operationStatus, useStatus
      chargers.push({
        deviceId: cells[0], businessStatus: cells[1],
        operationStatus: cells[2], useStatus: cells[3]
      });
    }
    return judgeStatus(chargers);
  } catch (e) {
    if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    return { status: 'SKIP', evidence: { error: e.message }, message: `상태 검증 실패: ${e.message.slice(0, 100)}` };
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 5: 테스트 실행 (PASS)**

Run: `node --test tests/test_check_status.js`
Expected: 4/4 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/check_status.js tests/test_check_status.js tests/fixtures/plinkconnect_station_chargers.html
git commit -m "feat(check_status): charger status verification"
```

---

## Task 8: check_sheet.js — 영차영차 BR열 (TDD)

**Files:**
- Create: `tests/fixtures/sheet_gviz.csv`
- Create: `tests/test_check_sheet.js`
- Create: `lib/check_sheet.js`

- [ ] **Step 1: fixture** `tests/fixtures/sheet_gviz.csv`

```csv
"행","프로젝트ID","프로젝트명","BR(서비스개시일)"
"2","abc-uuid","OO아파트","2026-05-22"
"3","def-uuid","XX빌라",""
"4","ghi-uuid","ZZ아파트","2026-05-21"
```

> **참고:** 시트의 프로젝트ID 컬럼 인덱스는 **Task 16 첫 실행 시 확정**. 위 fixture는 컬럼명 기반 매칭 가정.

- [ ] **Step 2: 테스트** `tests/test_check_sheet.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGvizCsv, judgeSheet } from '../lib/check_sheet.js';
import { readFileSync } from 'node:fs';

const csv = readFileSync(new URL('./fixtures/sheet_gviz.csv', import.meta.url), 'utf8');

test('parseGvizCsv: CSV → rows 배열', () => {
  const rows = parseGvizCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['프로젝트ID'], 'abc-uuid');
  assert.equal(rows[0]['BR(서비스개시일)'], '2026-05-22');
});

test('judgeSheet: PASS — 날짜 일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'abc-uuid', '2026-05-22');
  assert.equal(r.status, 'PASS');
});

test('judgeSheet: FAIL — BR열 비어있음', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'def-uuid', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'MISSING');
});

test('judgeSheet: FAIL — 날짜 불일치', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'ghi-uuid', '2026-05-22');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.evidence.mismatchKind, 'DATE_MISMATCH');
});

test('judgeSheet: SKIP — projectId 행 자체가 시트에 없음', () => {
  const r = judgeSheet(parseGvizCsv(csv), 'missing-id', '2026-05-22');
  assert.equal(r.status, 'SKIP');
});
```

- [ ] **Step 3: 테스트 실행 (FAIL)**

Run: `node --test tests/test_check_sheet.js`

- [ ] **Step 4: 구현** `lib/check_sheet.js`

```javascript
const SHEET_ID = '18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI';
const GID = '300841532';
const PROJECT_ID_COL = '프로젝트ID';        // Task 16에서 실제 컬럼명/인덱스 확정 가능
const BR_COL = 'BR(서비스개시일)';

export function parseGvizCsv(text) {
  const lines = text.trim().split('\n');
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function judgeSheet(rows, projectId, pluglinkInitDate) {
  const row = rows.find(r => r[PROJECT_ID_COL] === projectId);
  if (!row) {
    return {
      status: 'SKIP',
      evidence: { rowNumber: null, brValue: null, pluglinkInitDate, mismatchKind: 'ROW_NOT_FOUND' },
      message: `시트에서 프로젝트ID ${projectId} 행을 찾지 못함`
    };
  }
  const br = (row[BR_COL] || '').trim();
  const rowNumber = parseInt(row['행'], 10) || null;
  if (!br) {
    return {
      status: 'FAIL',
      evidence: { rowNumber, brValue: null, pluglinkInitDate, mismatchKind: 'MISSING' },
      message: '영차영차 BR열 비어있음'
    };
  }
  if (br === pluglinkInitDate) {
    return {
      status: 'PASS',
      evidence: { rowNumber, brValue: br, pluglinkInitDate, mismatchKind: null },
      message: `BR열 ${br} 일치`
    };
  }
  return {
    status: 'FAIL',
    evidence: { rowNumber, brValue: br, pluglinkInitDate, mismatchKind: 'DATE_MISMATCH' },
    message: `BR열(${br}) ≠ 플링커넥트(${pluglinkInitDate})`
  };
}

export async function checkSheet(project, ctx) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
    const csv = await ctx.fetchSheetCsv(url);
    const rows = parseGvizCsv(csv);
    return judgeSheet(rows, project.projectId, project.initiatedAt);
  } catch (e) {
    return { status: 'SKIP', evidence: { error: e.message }, message: `시트 fetch 실패: ${e.message.slice(0, 100)}` };
  }
}
```

- [ ] **Step 5: 테스트 실행 (PASS)**

Run: `node --test tests/test_check_sheet.js`
Expected: 5/5 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/check_sheet.js tests/test_check_sheet.js tests/fixtures/sheet_gviz.csv
git commit -m "feat(check_sheet): yongchayongcha BR column matching"
```

---

## Task 9: notify.js — Slack DM 요약

**Files:**
- Create: `lib/notify.js`

- [ ] **Step 1: 구현** `lib/notify.js`

```javascript
import { WebClient } from '@slack/web-api';

export function buildSummaryText({ date, slot, summary, projects, dashboardUrl }) {
  const { totalProjects, byOverall } = summary;
  const fails = projects.filter(p => p.overall === 'FAIL').map(p => {
    const reasons = Object.entries(p.checks)
      .filter(([_, c]) => c.status === 'FAIL')
      .map(([name]) => ({ doc: '공문', rate: '요금제', status: '상태', sheet: '시트' }[name] + ' FAIL'));
    return `   · ${p.projectName} (${reasons.join(', ')})`;
  }).join('\n');

  const byCheckLine = ['doc', 'rate', 'status', 'sheet']
    .map(k => {
      const c = summary.byCheck[k];
      const label = { doc: '공문', rate: '요금제', status: '상태', sheet: '시트' }[k];
      return `${label} ${c.PASS}/${totalProjects}`;
    }).join(' · ');

  return [
    `[${date} ${slot}] 검증 완료`,
    `총 ${totalProjects}건 · PASS ${byOverall.PASS||0} · WARN ${byOverall.WARN||0} · FAIL ${byOverall.FAIL||0}`,
    byCheckLine,
    '',
    fails ? `FAIL 건:\n${fails}` : 'FAIL 건 없음',
    '',
    `대시보드: ${dashboardUrl}/?date=${date}&slot=${slot}`
  ].join('\n');
}

export async function sendDM({ token, userId, text, dryRun }) {
  if (dryRun) {
    console.log('--- DRY RUN DM ---\n' + text + '\n------------------');
    return { ok: true, dryRun: true };
  }
  const client = new WebClient(token);
  return client.chat.postMessage({ channel: userId, text });
}
```

- [ ] **Step 2: 간단 테스트** `tests/test_notify.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryText } from '../lib/notify.js';

test('buildSummaryText: FAIL 건 나열', () => {
  const text = buildSummaryText({
    date: '2026-05-22', slot: 'evening',
    summary: {
      totalProjects: 5,
      byOverall: { PASS: 2, WARN: 1, FAIL: 2 },
      byCheck: {
        doc:    { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 },
        rate:   { PASS: 5, WARN: 0, FAIL: 0, SKIP: 0 },
        status: { PASS: 3, WARN: 1, FAIL: 1, SKIP: 0 },
        sheet:  { PASS: 4, WARN: 0, FAIL: 1, SKIP: 0 }
      }
    },
    projects: [
      { projectName: 'OO아파트', overall: 'FAIL', checks: {
        doc: { status: 'FAIL' }, rate: { status: 'PASS' },
        status: { status: 'WARN' }, sheet: { status: 'FAIL' }
      }}
    ],
    dashboardUrl: 'https://service-init-audit.vercel.app'
  });
  assert.match(text, /총 5건/);
  assert.match(text, /OO아파트 \(공문 FAIL, 시트 FAIL\)/);
  assert.match(text, /service-init-audit\.vercel\.app/);
});
```

- [ ] **Step 3: 테스트 실행**

Run: `node --test tests/test_notify.js`
Expected: 1/1 PASS

- [ ] **Step 4: Commit**

```bash
git add lib/notify.js tests/test_notify.js
git commit -m "feat(notify): slack dm summary builder"
```

---

## Task 10: manifest.js + retention.js

**Files:**
- Create: `lib/manifest.js`
- Create: `lib/retention.js`
- Create: `tests/test_manifest.js`
- Create: `tests/test_retention.js`

- [ ] **Step 1: manifest 테스트** `tests/test_manifest.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertManifest } from '../lib/manifest.js';

test('upsertManifest: 새 슬롯 추가', () => {
  const m = { lastUpdated: '2026-05-21T18:00:00+09:00', slots: [] };
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: '2026-05-22-morning.json',
    summary: { totalProjects: 3, byOverall: { PASS: 3 } }
  });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].date, '2026-05-22');
});

test('upsertManifest: 같은 (date, slot) 덮어쓰기', () => {
  const m = { lastUpdated: '', slots: [
    { date: '2026-05-22', slot: 'morning', file: 'x.json', summary: { totalProjects: 1 } }
  ]};
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: '2026-05-22-morning.json',
    summary: { totalProjects: 3 }
  });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].summary.totalProjects, 3);
});

test('upsertManifest: 90일 초과 제거', () => {
  const m = { lastUpdated: '', slots: [
    { date: '2025-01-01', slot: 'morning', file: 'old.json', summary: {} }
  ]};
  const r = upsertManifest(m, {
    date: '2026-05-22', slot: 'morning',
    file: 'new.json', summary: {}
  }, { retentionDays: 90, today: '2026-05-22' });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].file, 'new.json');
});
```

- [ ] **Step 2: manifest 구현** `lib/manifest.js`

```javascript
export function upsertManifest(manifest, entry, opts = {}) {
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const slots = (manifest.slots || [])
    .filter(s => s.date >= cutoffStr)
    .filter(s => !(s.date === entry.date && s.slot === entry.slot));
  slots.push(entry);
  slots.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

  return { lastUpdated: new Date().toISOString(), slots };
}
```

- [ ] **Step 3: manifest 테스트 실행 (PASS)**

Run: `node --test tests/test_manifest.js`
Expected: 3/3 PASS

- [ ] **Step 4: retention 테스트** `tests/test_retention.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneDataDir } from '../lib/retention.js';

test('pruneDataDir: 90일 초과 파일 삭제', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'retention-'));
  writeFileSync(path.join(dir, '2025-01-01-morning.json'), '{}');
  writeFileSync(path.join(dir, '2026-05-22-morning.json'), '{}');
  writeFileSync(path.join(dir, 'index.json'), '{}');

  pruneDataDir(dir, { retentionDays: 90, today: '2026-05-22' });
  const left = readdirSync(dir).sort();
  assert.deepEqual(left, ['2026-05-22-morning.json', 'index.json']);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 5: retention 구현** `lib/retention.js`

```javascript
import { readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;

export function pruneDataDir(dir, opts = {}) {
  const retentionDays = opts.retentionDays ?? 90;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const deleted = [];

  for (const name of readdirSync(dir)) {
    const m = name.match(DATE_PREFIX);
    if (!m) continue;
    if (m[1] < cutoffStr) {
      rmSync(path.join(dir, name));
      deleted.push(name);
    }
  }
  return deleted;
}
```

- [ ] **Step 6: retention 테스트 실행 (PASS)**

Run: `node --test tests/test_retention.js`
Expected: 1/1 PASS

- [ ] **Step 7: Commit**

```bash
git add lib/manifest.js lib/retention.js tests/test_manifest.js tests/test_retention.js
git commit -m "feat(manifest,retention): index.json upsert + 90d prune"
```

---

## Task 11: audit.js — 진입점 통합

**Files:**
- Create: `audit.js`

- [ ] **Step 1: 구현** `audit.js`

```javascript
#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { google } from 'googleapis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { discoverProjects } from './lib/discover.js';
import { openSession, closeSession } from './lib/playwright_session.js';
import { checkDoc } from './lib/check_doc.js';
import { checkRate } from './lib/check_rate.js';
import { checkStatus } from './lib/check_status.js';
import { checkSheet } from './lib/check_sheet.js';
import { sendDM, buildSummaryText } from './lib/notify.js';
import { upsertManifest } from './lib/manifest.js';
import { pruneDataDir } from './lib/retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

async function main() {
  const slot = args.slot;
  if (!['morning', 'evening'].includes(slot)) throw new Error('--slot must be morning|evening');
  const date = args.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const dryRun = args['dry-run'] === true;
  const dataDir = path.join(__dirname, 'data');
  const logsDir = path.join(__dirname, 'logs');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  console.log(`[audit] slot=${slot} date=${date} dryRun=${dryRun}`);

  // 1. discover
  const projects = await discoverProjects({
    slot, date,
    token: process.env.SLACK_BOT_TOKEN,
    channelId: process.env.SLACK_CHANNEL_ID
  });
  console.log(`[discover] ${projects.length} projects found`);

  // 2. session 준비
  const ctx = await buildContext({ dryRun });

  // 3. 체커 순회
  const errors = [];
  for (const p of projects) {
    try {
      p.checks = {};
      // 병렬화 가능하지만 디버깅 편의로 순차
      p.checks.doc    = await safeRun('doc',    () => checkDoc(p, ctx),    errors, p);
      p.checks.rate   = await safeRun('rate',   () => checkRate(p, ctx),   errors, p);
      p.checks.status = await safeRun('status', () => checkStatus(p, ctx), errors, p);
      p.checks.sheet  = await safeRun('sheet',  () => checkSheet(p, ctx),  errors, p);
      p.overall = computeOverall(p.checks);
    } catch (e) {
      if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') {
        await closeSession();
        await sendDM({ token: process.env.SLACK_BOT_TOKEN, userId: process.env.NOTIFY_SLACK_USER_ID,
          text: '[audit] 플링커넥트 로그인 만료. chrome_profile 재인증 필요.', dryRun });
        process.exit(2);
      }
      throw e;
    }
  }

  // 4. JSON 저장
  const summary = computeSummary(projects);
  const out = {
    runAt: new Date().toISOString(),
    slot, date,
    sourceMessages: projects.map(p => ({ ts: p.ts, permalink: p.permalink, stationLinks: [`https://connect.pluglink.kr/stations/${p.stationId}`] })),
    projects, summary, errors
  };
  const outFile = path.join(dataDir, `${date}-${slot}.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[write] ${outFile}`);

  // 5. manifest 갱신 + retention
  const manifestPath = path.join(dataDir, 'index.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { slots: [] };
  const newManifest = upsertManifest(manifest, {
    date, slot, file: `${date}-${slot}.json`, summary
  }, { retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90), today: date });
  writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
  pruneDataDir(dataDir, { retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90), today: date });

  // 6. notify
  await sendDM({
    token: process.env.SLACK_BOT_TOKEN,
    userId: process.env.NOTIFY_SLACK_USER_ID,
    text: buildSummaryText({ date, slot, summary, projects, dashboardUrl: 'https://service-init-audit.vercel.app' }),
    dryRun
  });

  // 7. git push (dryRun일 땐 skip)
  if (!dryRun) {
    execSync(`git add data/ && git commit -m "data: ${date} ${slot} audit" && git push`, { cwd: __dirname, stdio: 'inherit' });
  }

  await closeSession();
  console.log('EXIT_CODE 0');
}

async function safeRun(name, fn, errors, project) {
  try { return await fn(); }
  catch (e) {
    if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    errors.push({ projectId: project.projectId, check: name, error: e.message });
    return { status: 'SKIP', evidence: { error: e.message }, message: `${name} 실행 중 예외` };
  }
}

function computeOverall(checks) {
  const order = ['PASS', 'SKIP', 'WARN', 'FAIL'];
  let worst = 'PASS';
  for (const c of Object.values(checks)) {
    if (order.indexOf(c.status) > order.indexOf(worst)) worst = c.status;
  }
  return worst;
}

function computeSummary(projects) {
  const byOverall = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  const byCheck = { doc: {}, rate: {}, status: {}, sheet: {} };
  for (const k of Object.keys(byCheck)) byCheck[k] = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const p of projects) {
    byOverall[p.overall] = (byOverall[p.overall] || 0) + 1;
    for (const [name, c] of Object.entries(p.checks)) {
      byCheck[name][c.status] = (byCheck[name][c.status] || 0) + 1;
    }
  }
  return { totalProjects: projects.length, byOverall, byCheck };
}

async function buildContext({ dryRun }) {
  // playwright
  const browserContext = await openSession({
    profileDir: process.env.CHROME_PROFILE_DIR || './chrome_profile',
    headless: !dryRun
  });

  // gmail
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

  // sheet csv fetcher (browserContext 재사용해 docs.google.com에서 fetch)
  const fetchSheetCsv = async (url) => {
    const page = await browserContext.newPage();
    try {
      await page.goto('https://docs.google.com');
      const text = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        return r.text();
      }, url);
      return text;
    } finally { await page.close(); }
  };

  // pm emails
  const pmEmailsJson = JSON.parse(readFileSync(path.join(__dirname, 'config/pm_emails.json'), 'utf8'));
  const pmEmails = Object.values(pmEmailsJson).map(v => v.email);

  return {
    browserContext,
    plinkconnectBase: process.env.PLINKCONNECT_BASE || 'https://connect.pluglink.kr',
    gmail: oauth2Client,
    pmEmails,
    myEmail: process.env.GMAIL_USER || 'woojung.kim@pluglink.kr',
    fetchSheetCsv
  };
}

function parseArgs(arr) {
  const out = {};
  for (const a of arr) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    }
  }
  return out;
}

main().catch(err => {
  console.error('[audit] FATAL', err);
  console.log('EXIT_CODE 1');
  process.exit(1);
});
```

- [ ] **Step 2: dotenv 의존성 추가**

```bash
npm install dotenv
```

- [ ] **Step 3: Commit**

```bash
git add audit.js package.json package-lock.json
git commit -m "feat(audit): orchestration entrypoint"
```

---

## Task 12: 정적 대시보드 (public/)

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>서비스개시 검증 대시보드</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<aside id="sidebar">
  <h1>📋 검증</h1>
  <div id="last-updated"></div>
  <ul id="date-list"></ul>
</aside>
<main id="main">
  <div id="header"></div>
  <div id="summary"></div>
  <div id="filters">
    <label><input type="checkbox" id="filter-fail-only"> FAIL/WARN만 보기</label>
  </div>
  <section id="slot-morning"></section>
  <section id="slot-evening"></section>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: styles.css**

```css
* { box-sizing: border-box; }
body { font-family: -apple-system, "Noto Sans KR", sans-serif; margin: 0; display: flex; }
#sidebar { width: 220px; background: #f5f5f7; height: 100vh; padding: 16px; overflow-y: auto; border-right: 1px solid #ddd; }
#sidebar h1 { font-size: 16px; margin: 0 0 12px; }
#date-list { list-style: none; padding: 0; margin: 0; }
#date-list li { padding: 6px 8px; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; font-size: 13px; }
#date-list li:hover { background: #e8e8ec; }
#date-list li.active { background: #007aff; color: white; }
#main { flex: 1; padding: 24px; overflow-y: auto; height: 100vh; }
#summary { background: #fff8e1; padding: 12px; border-radius: 8px; margin: 16px 0; font-size: 14px; }
section { margin: 16px 0; }
.slot-title { font-weight: 600; cursor: pointer; padding: 8px 0; }
.card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 8px 0; }
.card.fail { border-left: 4px solid #e53935; }
.card.warn { border-left: 4px solid #fb8c00; }
.card.pass { border-left: 4px solid #43a047; }
.card.skip { border-left: 4px solid #9e9e9e; }
.checks { display: flex; gap: 12px; margin-top: 6px; font-size: 13px; }
.checks span.pass { color: #2e7d32; }
.checks span.warn { color: #ef6c00; }
.checks span.fail { color: #c62828; }
.checks span.skip { color: #616161; }
.evidence { margin-top: 8px; padding: 8px; background: #fafafa; border-radius: 4px; font-size: 12px; display: none; }
.card.expanded .evidence { display: block; }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 3px; }
.dot.morning { background: #ff9800; }
.dot.evening { background: #5e35b1; }
a { color: #007aff; text-decoration: none; }
```

- [ ] **Step 3: app.js**

```javascript
const state = { manifest: null, current: null, slotData: { morning: null, evening: null }, filterFailOnly: false };

async function init() {
  const r = await fetch('/data/index.json');
  state.manifest = await r.json();
  document.getElementById('last-updated').textContent = '마지막 갱신: ' + new Date(state.manifest.lastUpdated).toLocaleString('ko-KR');
  renderSidebar();
  const dates = uniqueDates(state.manifest.slots).reverse();
  if (dates.length) await selectDate(dates[0]);

  document.getElementById('filter-fail-only').addEventListener('change', (e) => {
    state.filterFailOnly = e.target.checked;
    renderBody();
  });
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
  for (const li of document.querySelectorAll('#date-list li')) li.classList.toggle('active', li.dataset.date === date);
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
    for (const k of ['PASS','WARN','FAIL','SKIP']) acc.byOverall[k] += d.summary.byOverall[k] || 0;
    for (const ck of ['doc','rate','status','sheet']) {
      acc.byCheck[ck] = acc.byCheck[ck] || { PASS:0,WARN:0,FAIL:0,SKIP:0 };
      for (const st of ['PASS','WARN','FAIL','SKIP']) acc.byCheck[ck][st] += d.summary.byCheck[ck]?.[st] || 0;
    }
    return acc;
  }, { totalProjects: 0, byOverall: { PASS:0,WARN:0,FAIL:0,SKIP:0 }, byCheck: {} });

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

  el.innerHTML = `<div class="slot-title">${title} (${projects.length}건)</div>` + projects.map(renderCard).join('');
  for (const c of el.querySelectorAll('.card')) c.addEventListener('click', () => c.classList.toggle('expanded'));
}

function renderCard(p) {
  const labels = { doc: '📭 공문', rate: '💰 요금제', status: '⚙️ 상태', sheet: '📊 시트' };
  const checks = Object.entries(p.checks).map(([k, c]) =>
    `<span class="${c.status.toLowerCase()}">${labels[k]} ${c.status}</span>`
  ).join('');
  return `
    <div class="card ${p.overall.toLowerCase()}">
      <div><b>[${p.overall}]</b> ${p.projectName} · 서비스개시일 ${p.initiatedAt} · 충전기 ${p.chargerCount}대</div>
      <div class="checks">${checks}</div>
      <div class="evidence">
        ${Object.entries(p.checks).map(([k, c]) => `<div><b>${labels[k]}</b>: ${c.message}</div>`).join('')}
      </div>
    </div>
  `;
}

init();
```

- [ ] **Step 4: Commit**

```bash
git add public/
git commit -m "feat(dashboard): static html/js dashboard with date filter"
```

---

## Task 13: 최초 통합 테스트 (dry-run, slot=morning, 빈 데이터)

**Files:** (없음 — 실행만)

- [ ] **Step 1: .env 작성**

```bash
cp config/.env.example config/.env
```

`config/.env`에 실제 값 채우기 (사용자가 수동):
- `SLACK_BOT_TOKEN` (Slack 앱에서 발급)
- `NOTIFY_SLACK_USER_ID` (woojung DM 대상)
- Gmail OAuth 정보
- `CHROME_PROFILE_DIR`은 기본값 사용

- [ ] **Step 2: chrome_profile 초기 로그인**

`pluglink-connect-login` 스킬을 호출하거나, 다음 임시 스크립트:

```javascript
// scripts/login_once.js
import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('./chrome_profile', { headless: false });
const page = await ctx.newPage();
await page.goto('https://connect.pluglink.kr/login');
console.log('로그인 후 이 창을 닫으세요');
```

```bash
node scripts/login_once.js
```

- [ ] **Step 3: 빈 슬롯 dry-run**

```bash
node audit.js --slot=morning --date=2026-05-22 --dry-run
```

Expected:
- `[discover] 0 projects found` (오늘 그 시간대 슬랙 메시지가 없으면)
- `data/2026-05-22-morning.json` 생성, `projects: []`
- `--- DRY RUN DM ---` 출력
- `EXIT_CODE 0`

- [ ] **Step 4: 전체 테스트 재실행 확인**

```bash
node --test tests/
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: Commit (data/index.json만)**

```bash
git add data/index.json
git commit -m "test: first dry-run with empty slot"
```

---

## Task 14: 셀렉터 확정 — 사용자와 함께 (실데이터 검증)

플링커넥트 페이지 구조는 사용자 PC에서 실제 페이지를 열어 확인.

- [ ] **Step 1: 검증용 슬랙 메시지 확보**

사용자에게 요청:
- 슬랙 채널 `C026XGZE1GT`에서 최근 서비스개시 알림 메시지 1개의 permalink를 제공
- 본 plan을 실행하는 세션은 그 메시지를 직접 열어 `text` 구조를 검사

- [ ] **Step 2: discover 셀렉터 검증**

샘플 메시지 텍스트로 `parseSlackMessages` 직접 호출:

```bash
node -e "import('./lib/discover.js').then(m => console.log(m.parseSlackMessages([{ts:'1.0',type:'message',text:'실제메시지'}])))"
```

추출 안 되면 정규식 보정 후 fixture·테스트 추가.

- [ ] **Step 3: 플링커넥트 페이지 셀렉터 확정**

```bash
node scripts/inspect_plinkconnect.js --projectId=<실제> --stationId=<실제>
```

`scripts/inspect_plinkconnect.js` (신규 작성):

```javascript
import { openSession } from '../lib/playwright_session.js';
const ctx = await openSession({ profileDir: './chrome_profile', headless: false });
const page = await ctx.newPage();
const projectId = process.argv.find(a => a.startsWith('--projectId='))?.split('=')[1];
const stationId = process.argv.find(a => a.startsWith('--stationId='))?.split('=')[1];

await page.goto(`https://connect.pluglink.kr/projects/${projectId}?tab=contract`);
console.log('계약탭 열림 — DevTools로 셀렉터 확인. 30초 대기.');
await page.waitForTimeout(30000);

await page.goto(`https://connect.pluglink.kr/stations/${stationId}`);
console.log('충전소 페이지 — 하단 충전기 테이블 셀렉터 확인.');
await page.waitForTimeout(30000);

await ctx.close();
```

DevTools에서 실제 셀렉터를 확인하여 `lib/check_rate.js` 및 `lib/check_status.js`의 셀렉터 부분 수정.

- [ ] **Step 4: 수정 후 통합 테스트 재실행 (실데이터)**

```bash
node audit.js --slot=morning --date=<실제 메시지 있던 날> --dry-run
```

Expected: 실제 메시지에 대해 4종 체크 결과가 들어간 JSON 생성.

- [ ] **Step 5: 시트 컬럼 인덱스 확정**

```bash
node -e "
import('./lib/playwright_session.js').then(async m => {
  const ctx = await m.openSession({ profileDir: './chrome_profile' });
  const page = await ctx.newPage();
  await page.goto('https://docs.google.com');
  const csv = await page.evaluate(async () => {
    const r = await fetch('https://docs.google.com/spreadsheets/d/18FUfm4dSGBkUZp1Oxj2DZ7tfkE5Wrh_ZyNza93CFkwI/gviz/tq?tqx=out:csv&gid=300841532', { credentials: 'include' });
    return r.text();
  });
  console.log(csv.split('\n').slice(0,3).join('\n'));
  await ctx.close();
});
"
```

헤더 행을 보고 `lib/check_sheet.js`의 `PROJECT_ID_COL`, `BR_COL` 상수 수정.

- [ ] **Step 6: Commit**

```bash
git add lib/check_rate.js lib/check_status.js lib/check_sheet.js scripts/inspect_plinkconnect.js
git commit -m "fix: confirm real-data selectors for plinkconnect & sheet columns"
```

---

## Task 15: Vercel 배포

- [ ] **Step 1: Vercel 프로젝트 생성**

```bash
cd "C:/Users/user/Documents/claude/service-init-audit"
vercel login   # 한 번
vercel link    # 신규 프로젝트로 연결
```

- [ ] **Step 2: 첫 배포**

```bash
vercel --prod
```

Expected: URL 발급 (예: `service-init-audit-abc.vercel.app`)

- [ ] **Step 3: 발급 URL을 .env와 notify.js 기본값에 반영**

`audit.js` 안의 `dashboardUrl: 'https://service-init-audit.vercel.app'` 부분을 실제 URL로 수정.

- [ ] **Step 4: 브라우저 확인**

발급 URL을 열어:
- 좌측 사이드바에 날짜 점(●) 보이는지
- 카드 클릭 시 evidence 펼침
- FAIL/WARN 필터 작동

- [ ] **Step 5: Commit**

```bash
git add audit.js vercel.json .vercel
git commit -m "chore: vercel deployment configured"
```

---

## Task 16: Windows 작업 스케줄러 등록

- [ ] **Step 1: scheduled-tasks MCP로 등록**

morning task:
```
mcp__scheduled-tasks__create_scheduled_task with:
  name: "service-init-audit-morning"
  schedule: "0 30 8 * * *"   (또는 MCP 입력 형식)
  command: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\user\\Documents\\claude\\service-init-audit\\audit.js\" --slot=morning"
  cwd: "C:\\Users\\user\\Documents\\claude\\service-init-audit"
```

evening task:
```
mcp__scheduled-tasks__create_scheduled_task with:
  name: "service-init-audit-evening"
  schedule: "0 30 17 * * *"
  command: 동일 — --slot=evening
  cwd: 동일
```

- [ ] **Step 2: 수동 실행 테스트**

다음날 아침 자동 실행 전, 즉시 수동 트리거:

```powershell
Start-ScheduledTask -TaskName "service-init-audit-morning"
```

10분 후 `data/`에 새 JSON 생성 확인.

- [ ] **Step 3: Commit (스케줄러 등록 로그용)**

```bash
git add docs/
git commit -m "chore: register windows scheduled tasks for 08:30/17:30"
```

---

## Task 17: 정상작동 확인 — 라이브 슬롯 검증

- [ ] **Step 1: 실제 슬롯(8:30 또는 17:30) 자동 실행 결과 확인**

스케줄러가 정상 실행된 후:
- `data/YYYY-MM-DD-{slot}.json` 신규 파일 존재
- `logs/YYYY-MM-DD-{slot}.log`에 stderr/stdout 기록
- Slack DM 도착
- Vercel 대시보드에서 새 날짜 표시

- [ ] **Step 2: 결과 정확성 검증 (수동 spot-check)**

산출 JSON에서 임의로 1~2건 골라:
- `check_doc` 매칭된 메일을 Gmail에서 직접 열어 실재 확인
- `check_rate.diff`가 실제로 일치/불일치 확인
- `check_status.abnormal` 충전기 상태 페이지에서 재확인
- `check_sheet.brValue` vs 영차영차 시트 직접 확인

오탐·미탐 발견 시 해당 체커 수정 + 회귀 테스트 fixture 추가 → 새 commit.

- [ ] **Step 3: 사용자 승인**

본 plan을 실행한 에이전트는 위 결과를 표로 정리해 사용자에게 보고:

```
| 슬롯 | 검출 건 | PASS | WARN | FAIL | SKIP | 비고 |
|---|---|---|---|---|---|---|
| 2026-05-22 morning | 3 | 1 | 1 | 1 | 0 | spot-check OK |
```

사용자가 "OK"라고 확인하면 다음 Task로.

---

## Task 18: Obsidian 기록

- [ ] **Step 1: Obsidian 경로/볼트 확인**

사용자에게 묻는다:
> "Obsidian 볼트 경로와, 이 프로젝트 메모를 어느 폴더에 두면 될지 알려주세요."

(예: `C:\Users\user\Documents\Obsidian\Pluglink\Projects\service-init-audit.md`)

- [ ] **Step 2: 메모 작성**

```markdown
# 서비스개시 검증 대시보드

- 생성: 2026-05-22
- 위치: C:\Users\user\Documents\claude\service-init-audit
- 대시보드: https://<vercel-url>
- 슬랙 채널: C026XGZE1GT (관찰 대상)

## 무엇을 검증하나
플링커넥트에서 당일 서비스개시된 충전기에 대해 매일 08:30 / 17:30 KST에 4가지를 자동 검증.

| 체크 | 소스 | PASS 조건 |
|---|---|---|
| 공문 | Gmail (PM cc 메일) | PM 발송 메일 중 프로젝트명/충전소명 매칭 & cc:me 존재 |
| 요금제 | 플링커넥트 3단 | 계약탭 요금제 ↔ 충전소 요금제탭 적용 충전기 ↔ 프로젝트 서비스개시 탭, 특가는 합의서 첨부 필수 |
| 상태 | 플링커넥트 충전소 하단 | 사업개시 & 운영 & 사용가능 |
| 시트 | 영차영차new BR열 | BR == 플링커넥트 서비스개시일, 비어있으면 FAIL |

## 운영
- Windows 작업 스케줄러로 08:30 / 17:30 자동 실행
- 로그인 만료 시 Slack DM 통지 → `node scripts/login_once.js` 재로그인
- 데이터 90일 보관

## 관련 문서
- 설계서: `docs/superpowers/specs/2026-05-22-service-init-audit-dashboard-design.md`
- 구현 계획: `docs/superpowers/plans/2026-05-22-service-init-audit-dashboard.md`
```

- [ ] **Step 3: 메모리에도 short ref 추가** (`~/.claude/projects/.../memory/MEMORY.md`에 한 줄)

```markdown
- [서비스개시 검증 대시보드](reference_service_init_audit.md) — 플링커넥트 당일 개시 충전기 4종(공문/요금제/상태/시트) 자동 검증, 08:30/17:30 KST, service-init-audit.vercel.app
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: obsidian + memory refs for service-init-audit"
```

---

## Self-Review

**Spec coverage:**
- §1 배경 → Task 1 README ✓
- §2 범위 → Task 1-18 전체 ✓
- §3 아키텍처 → Task 11 audit.js ✓
- §4 실행 시간 08:30/17:30 → Task 16 ✓
- §5 데이터 모델 → Task 11 + 12 ✓
- §6.1 check_doc → Task 5 ✓
- §6.2 check_rate → Task 6 ✓
- §6.3 check_status → Task 7 ✓
- §6.4 check_sheet → Task 8 ✓
- §7 대시보드 UI → Task 12 ✓
- §8 알림 DM → Task 9 ✓
- §9 디렉토리 → Task 1 ✓
- §10 에러 처리 → Task 11 safeRun ✓
- §11 로그 → Task 11 mkdirSync(logsDir) ✓
- §12 스케줄러 → Task 16 ✓
- §13 보관 90일 → Task 10 retention ✓
- §14 미해결 5가지 → Task 14 ✓
- §15 향후 확장 — 본 plan 범위 외 (OK)

**Placeholder scan:** `[data-test="..."]` 셀렉터는 placeholder임을 Task 6에서 명시하고 Task 14에서 실데이터 확정 단계로 분리. 다른 TBD/TODO 없음.

**Type consistency:**
- `CheckResult` 시그니처 `{ status, evidence, message }` 모든 체커 일관 ✓
- `judgeRate`, `judgeStatus`, `judgeSheet` 순수 판정 함수와 `checkRate`, `checkStatus`, `checkSheet` 통합 함수 분리 일관 ✓
- `parseSlackMessages` ↔ `discoverProjects` 사용처 일관 ✓
- `upsertManifest` 인자 형태 ↔ Task 11 호출 형태 일치 ✓
