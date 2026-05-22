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
      p.checks.doc    = await safeRun('doc',    () => checkDoc(p, ctx),    errors, p);
      p.checks.rate   = await safeRun('rate',   () => checkRate(p, ctx),   errors, p);
      p.checks.status = await safeRun('status', () => checkStatus(p, ctx), errors, p);
      p.checks.sheet  = await safeRun('sheet',  () => checkSheet(p, ctx),  errors, p);
      p.overall = computeOverall(p.checks);
    } catch (e) {
      if (e.message === 'PLINKCONNECT_LOGIN_EXPIRED') {
        await closeSession();
        await sendDM({
          token: process.env.SLACK_BOT_TOKEN,
          userId: process.env.NOTIFY_SLACK_USER_ID,
          text: '[audit] 플링커넥트 로그인 만료. chrome_profile 재인증 필요.',
          dryRun
        });
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
    sourceMessages: projects.map(p => ({
      ts: p.ts, permalink: p.permalink,
      stationLinks: [`https://connect.pluglink.kr/stations/${p.stationId}`]
    })),
    projects, summary, errors
  };
  const outFile = path.join(dataDir, `${date}-${slot}.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[write] ${outFile}`);

  // 5. manifest 갱신 + retention
  const manifestPath = path.join(dataDir, 'index.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { slots: [] };
  const newManifest = upsertManifest(manifest, {
    date, slot, file: `${date}-${slot}.json`, summary
  }, { retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90), today: date });
  writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
  pruneDataDir(dataDir, {
    retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90),
    today: date
  });

  // 6. notify
  await sendDM({
    token: process.env.SLACK_BOT_TOKEN,
    userId: process.env.NOTIFY_SLACK_USER_ID,
    text: buildSummaryText({
      date, slot, summary, projects,
      dashboardUrl: process.env.DASHBOARD_URL || 'https://service-init-audit.vercel.app'
    }),
    dryRun
  });

  // 7. git push (dryRun이면 skip)
  if (!dryRun) {
    execSync(`git add data/ && git commit -m "data: ${date} ${slot} audit" && git push`, {
      cwd: __dirname, stdio: 'inherit'
    });
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
  // 우선순위: FAIL > WARN > SKIP > PASS
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
  const browserContext = await openSession({
    profileDir: process.env.CHROME_PROFILE_DIR || './chrome_profile',
    headless: !dryRun
  });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

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
