#!/usr/bin/env node
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { google } from 'googleapis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { discoverStations } from './lib/discover.js';
import { discoverTomorrowStations, nextTargetDates } from './lib/discover_tomorrow.js';
import { isExcludedProject } from './lib/project_filter.js';
import { openSession, closeSession } from './lib/playwright_session.js';
import { ensureSession } from './lib/plinkconnect_auth.js';
import { fetchStationData, filterNewChargers } from './lib/enrich_station.js';
import { checkDoc } from './lib/check_doc.js';
import { checkRate } from './lib/check_rate.js';
import { checkStatus } from './lib/check_status.js';
import { checkSheet } from './lib/check_sheet.js';
import { sendDM, buildSummaryText } from './lib/notify.js';
import { upsertManifest } from './lib/manifest.js';
import { pruneDataDir } from './lib/retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, 'config', '.env') });
const args = parseArgs(process.argv.slice(2));
const RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS || 90);
const PLINKCONNECT_BASE = process.env.PLINKCONNECT_BASE || 'https://connect.pluglink.kr';

async function main() {
  const slot = args.slot;
  if (!['morning', 'evening'].includes(slot)) throw new Error('--slot must be morning|evening');
  const date = args.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const dryRun = args['dry-run'] === true;
  // Vercel outputDirectory=public 이 /data/* 를 그대로 서빙하도록 public/data 에 직접 기록
  const dataDir = path.join(__dirname, 'public', 'data');
  const logsDir = path.join(__dirname, 'logs');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  console.log(`[audit] slot=${slot} date=${date} dryRun=${dryRun}`);

  // 1. discover — 슬랙 1 메시지에서 여러 충전소 추출
  let stations;
  try {
    stations = await discoverStations({
      slot, date,
      token: process.env.SLACK_BOT_TOKEN,
      channelId: process.env.SLACK_CHANNEL_ID
    });
    console.log(`[discover] ${stations.length} stations found`);
  } catch (e) {
    const slackErr = /slack history failed: (.+)/.exec(e?.message ?? '')?.[1];
    if (slackErr === 'not_in_channel' || slackErr === 'channel_not_found') {
      console.warn(`[discover] ⚠️ ${slackErr} — 봇을 채널 ${process.env.SLACK_CHANNEL_ID}에 초대해야 메시지를 읽을 수 있습니다. 이번 슬롯은 0건으로 진행.`);
      stations = [];
    } else {
      throw e;
    }
  }

  // 2. session/context — stations 0건이면 비싼 세션 생성 skip
  let ctx = null;
  if (stations.length > 0) {
    try {
      ctx = await buildContext({ dryRun });
    } catch (e) {
      await closeSession();
      throw e;
    }
  } else {
    console.log('[audit] stations 0건 — Playwright 세션 생략');
  }

  try {
    const errors = [];

    // 2.5 세션 보장 — 만료 시 자동 로그인
    if (ctx) {
      try {
        await ensureSession(ctx.browserContext, {
          base: PLINKCONNECT_BASE,
          username: process.env.PLINKCONNECT_USERNAME,
          password: process.env.PLINKCONNECT_PASSWORD
        });
      } catch (e) {
        // 자동 로그인 실패 시 Slack 통지 후 종료
        await sendDM({
          token: process.env.SLACK_BOT_TOKEN,
          userId: process.env.NOTIFY_SLACK_USER_ID,
          text: `[audit] 플링커넥트 자동 로그인 실패: ${e?.message ?? e}. 자격증명 확인 필요.`,
          dryRun
        });
        process.exitCode = 2;
        return;
      }
    }

    // 3. enrich — 각 충전소 페이지 fetch (주소, projectIds, 충전기 리스트, 신규 충전기)
    if (ctx) {
      for (const s of stations) {
        try {
          const page = await ctx.browserContext.newPage();
          try {
            const data = await fetchStationData(page, s.stationId, PLINKCONNECT_BASE);
            // enrich에서 못 잡은 필드는 슬랙 원본 보존
            s.stationName = data.stationName ?? s.stationName;
            s.address = data.address ?? null;
            s.projectIds = data.projectIds ?? [];
            s.chargers = data.chargers ?? [];
            // stationId는 슬랙이 ground-truth (URL에서 추출) — 덮어쓰지 않음
            s.newChargers = filterNewChargers(s.chargers, date);
            s.initiatedAt = s.headerDate ?? date;
          } finally { await page.close(); }
        } catch (e) {
          if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
          const msg = e?.message ?? String(e);
          errors.push({ stationId: s.stationId, stage: 'enrich', error: msg.slice(0, 200) });
          s.enrichError = msg;
          // 빈 필드로 채워 체커가 SKIP할 수 있게
          s.address = s.address ?? null;
          s.projectIds = s.projectIds ?? [];
          s.chargers = s.chargers ?? [];
          s.newChargers = s.newChargers ?? [];
          s.initiatedAt = s.initiatedAt ?? date;
        }
      }
      console.log(`[enrich] ${stations.length - errors.filter(e => e.stage === 'enrich').length} OK, ${errors.filter(e => e.stage === 'enrich').length} 실패`);
    }

    // 4. 체커 순회
    for (const s of stations) {
      try {
        s.checks = {};
        // sheet 먼저 — 매칭 행의 projectName(E열)을 station에 채워 doc 키워드로 활용
        s.checks.sheet  = await safeRun('sheet',  () => checkSheet(s, ctx),  errors, s);
        s.projectName = s.checks.sheet.evidence?.projectName ?? null;
        // [HM] 프로젝트는 우리 알림 대상 아님 — 이후 체크 생략하고 목록에서 제외
        if (isExcludedProject(s.projectName)) {
          s.excluded = true;
          console.log(`  [exclude] [HM] 프로젝트 제외: ${s.stationName ?? s.stationId} (${s.projectName})`);
          continue;
        }
        s.checks.doc    = await safeRun('doc',    () => checkDoc(s, ctx),    errors, s);
        s.checks.rate   = await safeRun('rate',   () => checkRate(s, ctx),   errors, s);
        s.checks.status = await safeRun('status', () => checkStatus(s, ctx), errors, s);
        s.overall = computeOverall(s.checks);
      } catch (e) {
        if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') {
          await sendDM({
            token: process.env.SLACK_BOT_TOKEN,
            userId: process.env.NOTIFY_SLACK_USER_ID,
            text: '[audit] 플링커넥트 로그인 만료. chrome_profile 재인증 필요.',
            dryRun
          });
          process.exitCode = 2;
          return;
        }
        throw e;
      }
    }
    // [HM] 제외 충전소를 목록에서 제거 (summary·notify·JSON 모두에서 빠짐)
    const excludedCount = stations.filter(s => s.excluded).length;
    if (excludedCount) console.log(`[exclude] [HM] 프로젝트 ${excludedCount}건 알림 대상에서 제외`);
    stations = stations.filter(s => !s.excluded);

    // 4.5 evening 슬롯: 다음 개시 예정 충전소 — 영차영차new BR 기재 확인만.
    //   아직 개시 전이므로 공문/요금제/상태 등 운영 체크는 하지 않는다(무의미).
    //   주말엔 자동 실행이 없어, 내일이 주말이면 그 주말+다음 영업일까지 한 번에 커버.
    //   discoverTomorrowStations가 대상일(nextTargetDates) BR 행만 추출하므로, 그 목록 자체가 확인 결과.
    let tomorrowStations = [];
    let tomorrowSummary = null;
    if (slot === 'evening' && ctx) {
      try {
        const targetDates = nextTargetDates(date);
        tomorrowStations = await discoverTomorrowStations(ctx.fetchSheetCsv, date);
        console.log(`[tomorrow] ${tomorrowStations.length} stations scheduled for ${targetDates.join(', ')} (영차영차new BR 확인)`);
        tomorrowSummary = { totalStations: tomorrowStations.length, dates: targetDates };
      } catch (e) {
        console.error('[tomorrow] 실패:', e?.message ?? String(e));
        errors.push({ stage: 'tomorrow', error: (e?.message ?? String(e)).slice(0, 200) });
      }
    }

    // 5. JSON 저장
    const summary = computeSummary(stations);
    const out = {
      runAt: new Date().toISOString(),
      slot, date,
      sourceMessages: dedupeMessages(stations.map(s => ({
        ts: s.ts, permalink: s.permalink,
        stationLinks: s.stationId ? [`${PLINKCONNECT_BASE}/operation/stations/${s.stationId}/home`] : []
      }))),
      stations, summary,
      tomorrowStations, tomorrowSummary,
      errors
    };
    const outFile = path.join(dataDir, `${date}-${slot}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[write] ${outFile}`);

    // 6. manifest 갱신 + retention
    const manifestPath = path.join(dataDir, 'index.json');
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : { slots: [] };
    const newManifest = upsertManifest(manifest, {
      date, slot, file: `${date}-${slot}.json`, summary
    }, { retentionDays: RETENTION_DAYS, today: date });
    writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
    pruneDataDir(dataDir, { retentionDays: RETENTION_DAYS, today: date });

    // 7. notify — DM + 채널(설정 시) 동시 발송
    const notifyText = buildSummaryText({
      date, slot, summary, stations,
      tomorrowStations, tomorrowSummary,
      dashboardUrl: process.env.DASHBOARD_URL || 'https://service-init-audit.vercel.app'
    });
    await sendDM({
      token: process.env.SLACK_BOT_TOKEN,
      userId: process.env.NOTIFY_SLACK_USER_ID,
      text: notifyText,
      dryRun
    });
    if (process.env.NOTIFY_SLACK_CHANNEL_ID) {
      // 원본 서비스개시 알림(8AM/5PM) 메시지의 ts에 스레드 답글로.
      // sourceMessages가 비어있으면(evening인데 메시지 없음 등) 채널 메인으로 fallback.
      const threadTs = out.sourceMessages?.[0]?.ts || undefined;
      try {
        await sendDM({
          token: process.env.SLACK_BOT_TOKEN,
          userId: process.env.NOTIFY_SLACK_CHANNEL_ID,
          text: notifyText,
          dryRun,
          threadTs
        });
      } catch (e) {
        console.error('[notify] 채널 발송 실패:', e?.message ?? String(e));
      }
    }

    // 8. Vercel 배포 (dryRun이면 skip). public/data 가 정적 서빙됨.
    if (!dryRun) {
      try {
        execSync(`npx vercel deploy --prod --yes`, {
          cwd: __dirname, stdio: 'inherit'
        });
      } catch (e) {
        console.error('[audit] Vercel 배포 실패 (로컬 JSON은 보존됨):', e?.message ?? String(e));
      }
    }
  } finally {
    await closeSession();
  }

  console.log('EXIT_CODE ' + (process.exitCode ?? 0));
}

function dedupeMessages(arr) {
  const seen = new Set();
  return arr.filter(m => {
    if (seen.has(m.ts)) return false;
    seen.add(m.ts); return true;
  });
}

async function safeRun(name, fn, errors, station) {
  try {
    const result = await fn();
    if (result?.status === 'SKIP' && result?.evidence?.error) {
      errors.push({ stationId: station.stationId, check: name, error: result.evidence.error });
    }
    return result;
  }
  catch (e) {
    if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
    const msg = e?.message ?? String(e);
    errors.push({ stationId: station.stationId, check: name, error: msg });
    return { status: 'SKIP', evidence: { error: msg }, message: `${name} 실행 중 예외: ${msg.slice(0, 100)}` };
  }
}

function computeOverall(checks) {
  // SKIP은 "정보 부족"으로 취급 — PASS/FAIL 판정에 영향 없음.
  // FAIL 하나라도 → FAIL, WARN 하나라도 → WARN, PASS 하나라도 → PASS, 전부 SKIP → SKIP
  const statuses = Object.values(checks).map(c => c.status);
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('WARN')) return 'WARN';
  if (statuses.includes('PASS')) return 'PASS';
  return 'SKIP';
}

function computeSummary(stations) {
  const byOverall = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  const byCheck = { doc: {}, rate: {}, status: {}, sheet: {} };
  for (const k of Object.keys(byCheck)) byCheck[k] = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const s of stations) {
    byOverall[s.overall] = (byOverall[s.overall] || 0) + 1;
    for (const [name, c] of Object.entries(s.checks || {})) {
      byCheck[name][c.status] = (byCheck[name][c.status] || 0) + 1;
    }
  }
  return { totalStations: stations.length, byOverall, byCheck };
}

async function buildContext({ dryRun }) {
  // chrome_profile 경로를 __dirname 기준 절대경로로 — Windows 작업 스케줄러(cwd=system32)에서도 동작
  const profileDir = process.env.CHROME_PROFILE_DIR
    ? path.resolve(__dirname, process.env.CHROME_PROFILE_DIR)
    : path.join(__dirname, 'chrome_profile');
  // headless 기본: true. `--headful` 옵션 줄 때만 GUI.
  const browserContext = await openSession({
    profileDir,
    headless: !args.headful
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

  let pmEmails;
  try {
    const pmEmailsJson = JSON.parse(readFileSync(path.join(__dirname, 'config/pm_emails.json'), 'utf8'));
    pmEmails = Object.values(pmEmailsJson).map(v => v.email).filter(Boolean);
    if (pmEmails.length === 0) throw new Error('pm_emails.json: email 없음');
  } catch (e) {
    throw new Error(`pm_emails.json 로드 실패: ${e?.message ?? String(e)}`);
  }

  // 그룹 메일 — cc 인정 대상 (.env의 PM_GROUP_EMAILS=pm@pluglink.kr,team@pluglink.kr 등)
  const groupEmails = (process.env.PM_GROUP_EMAILS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  return {
    browserContext,
    plinkconnectBase: PLINKCONNECT_BASE,
    gmail: oauth2Client,
    pmEmails,
    myEmail: process.env.GMAIL_USER || 'woojung.kim@pluglink.kr',
    groupEmails,
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
