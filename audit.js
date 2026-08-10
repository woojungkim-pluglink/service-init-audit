#!/usr/bin/env node
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { discoverStations } from './lib/discover.js';
import { discoverTomorrowStations, nextTargetDates, pickRowsForDates } from './lib/discover_tomorrow.js';
import { resolveStationIdByProjectId } from './lib/resolve_station_id.js';
import { checkStatusRecent } from './lib/check_status_recent.js';
import { isExcludedProject } from './lib/project_filter.js';
import { remediateStation } from './lib/remediate_charger.js';
import { openSession, closeSession } from './lib/playwright_session.js';
import { ensureSession } from './lib/plinkconnect_auth.js';
import { fetchStationData, filterNewChargers } from './lib/enrich_station.js';
import { checkDoc } from './lib/check_doc.js';
import { checkRate } from './lib/check_rate.js';
import { checkStatus } from './lib/check_status.js';
import { judgeInitDate } from './lib/check_initdate.js';
import { judgeCommStatus } from './lib/check_commstatus.js';
import { checkSheet, loadYeongchaRows, findProjectNameByProjectIds } from './lib/check_sheet.js';
import { sendDM, buildSummaryText, buildSummaryBlocks } from './lib/notify.js';
import { upsertManifest, slotAlreadyDone } from './lib/manifest.js';
import { pruneDataDir } from './lib/retention.js';
import { buildGoogleAuth, makeSheetsCsvFetcher } from './lib/google_auth.js';
import { checkYeongchaShape } from './lib/sheet_guard.js';
import { runSettle } from './lib/settle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, 'config', '.env') });
const args = parseArgs(process.argv.slice(2));
const RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS || 90);
const PLINKCONNECT_BASE = process.env.PLINKCONNECT_BASE || 'https://connect.pluglink.kr';

/** errors[] 엔트리를 공개 대시보드용으로 정리 — 스택·내부 URL 제거, 첫 줄만, 길이 제한 */
function sanitizeError(e) {
  const clean = (s) => String(s ?? '')
    .split('\n')[0]
    .replace(/https?:\/\/[^\s)"']+/g, '[url]')
    .slice(0, 160);
  return e && typeof e === 'object' ? { ...e, error: clean(e.error) } : clean(e);
}

async function main() {
  const slot = args.slot;
  if (!['morning', 'evening'].includes(slot)) throw new Error('--slot must be morning|evening');
  const date = args.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const dryRun = args['dry-run'] === true;
  const settleOn = args['no-settle'] !== true; // 개시 후 30일 정착 추적 (대시보드 전용) — 기본 ON
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://service-init-audit.vercel.app';
  // Vercel outputDirectory=public 이 /data/* 를 그대로 서빙하도록 public/data 에 직접 기록
  const dataDir = path.join(__dirname, 'public', 'data');
  const logsDir = path.join(__dirname, 'logs');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  console.log(`[audit] slot=${slot} date=${date} dryRun=${dryRun}`);

  // 0. 중복 실행 방지 — 같은 (date, slot)이 이미 처리됐으면 즉시 종료.
  //   n8n 정시 트리거(on-time)와 GitHub cron 백업(지연)이 둘 다 도는 구조라,
  //   먼저 끝난 실행이 manifest(index.json)를 배포해 두면 이후 실행은 여기서 건너뛴다.
  //   (CI는 시작 시 live index.json을 seed함. --force 로 무시 가능 — 수동 재실행용.)
  if (!args.force && !dryRun) {
    const manifestPath = path.join(dataDir, 'index.json');
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (slotAlreadyDone(m, date, slot)) {
          console.log(`[dedup] ${date} ${slot} 이미 처리됨 — 알림·배포 생략 (재실행: --force)`);
          console.log('EXIT_CODE 0');
          return;
        }
      } catch { /* manifest 파싱 실패 → 그냥 진행 */ }
    }
  }

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
    // 접근권한 문제는 '개시 0건'과 다르다 — 조용히 0건으로 강등하면 장애가 정상으로 위장된다.
    //   WebClient는 PlatformError(e.data.error)로 던지므로 두 형태 모두 인식.
    const code = e?.data?.error
      || /slack history failed: (.+)/.exec(e?.message ?? '')?.[1]
      || /An API error occurred:\s*(\w+)/.exec(e?.message ?? '')?.[1];
    if (code === 'not_in_channel' || code === 'channel_not_found') {
      console.error(`[discover] 🔴 ${code} — 봇이 채널 ${process.env.SLACK_CHANNEL_ID}를 읽지 못함`);
      await sendDM({
        token: process.env.SLACK_BOT_TOKEN,
        userId: process.env.NOTIFY_SLACK_USER_ID,
        text: `🔴 [${date} ${slot}] 서비스개시 채널을 읽지 못함(${code}) — 봇 초대/채널ID 확인 필요. 검증 미수행.`,
        dryRun
      });
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  // 2. session/context — 비싼 세션은 필요할 때만.
  //   morning: 오늘 0건이면 생략. evening: 다음날 개시 예정 확인이 필요하므로 0건이어도 생성.
  let ctx = null;
  //   settle(정착 추적)은 커넥트 JWT가 필요해 morning 0건에도 세션을 만든다 (--no-settle 시 기존 최적화 유지)
  if (stations.length > 0 || slot === 'evening' || settleOn) {
    try {
      ctx = await buildContext({ dryRun });
    } catch (e) {
      await closeSession();
      throw e;
    }
  } else {
    console.log('[audit] morning 0건 + settle OFF — Playwright 세션 생략');
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
            // 충전소 상태(운영/미운영/폐쇄) — charger+station 3원 전이 누락 감지용
            s.stationStatus = data.stationStatusConflict ? null : (data.stationStatus ?? null);
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
      // 충전기 대수 현황: 기축(기존) + 개시(오늘) = 총. 알림 하단·대시보드 노출용.
      for (const s of stations) {
        const total = (s.chargers || []).length;
        const opened = (s.newChargers || []).length;
        s.chargerCounts = { total, opened, existing: Math.max(0, total - opened) };
      }
    }

    // 영차영차new 시트 1회 로드 — [HM] 판정(projectId 기준) + 오늘 개시 교차검증 공용.
    //   개시 0건인 날도 교차검증을 위해 로드한다: SA 모드는 브라우저 세션 없이 Sheets API로 가능.
    let yeongchaRows = null;
    let yeongchaLoadFailed = false;
    {
      try {
        let fetcher = ctx?.fetchSheetCsv ?? null;
        if (!fetcher) {
          const g = buildGoogleAuth();
          if (g.sheetsMode === 'sa') fetcher = makeSheetsCsvFetcher(g.sheetsAuth);
        }
        if (fetcher) yeongchaRows = await loadYeongchaRows(fetcher);
        else console.warn('[sheet] 시트 fetcher 없음(브라우저 세션·SA 모두 없음) — [HM] 판정·오늘개시 교차검증 생략');
      } catch (e) {
        yeongchaLoadFailed = true;
        console.warn('[sheet] 영차영차 시트 로드 실패 — [HM] 판정·오늘개시 교차검증 생략:', e?.message ?? String(e));
      }
    }

    // 3.6 시트 컬럼 이동 가드 — 개시일/주소 컬럼의 값 형태가 무너졌으면(장애 5·7 재발) 오탐 대신 즉시 중단.
    if (yeongchaRows) {
      const shape = checkYeongchaShape(yeongchaRows);
      if (!shape.ok) {
        console.error('[guard] 영차영차 시트 구조 이상:', shape.reason, JSON.stringify(shape.stats));
        await sendDM({
          token: process.env.SLACK_BOT_TOKEN,
          userId: process.env.NOTIFY_SLACK_USER_ID,
          text: `🔴 [${date} ${slot}] 영차영차new 시트 컬럼 구조 변경 의심 — 검증 중단(오탐 방지).\n${shape.reason}\n→ check_sheet.js/discover_tomorrow.js/sheet_guard.js의 컬럼 인덱스(주소 F=5, 개시일 BQ=68) 확인·수정 필요.`,
          dryRun
        });
        process.exitCode = 2;
        return;
      }
    }

    // 3.7 오늘 개시 교차검증 — 시트 개시일(BQ)==today 행(파트너 태그 제외)과 Slack 발견 목록 대조.
    //   상류 개시 알림 flow(operations-cs.flow.launched-charger-daily-notify)는 0기면 미전송·
    //   production 가드·relationPartnerId=1 필터라 '알림 없음'과 '개시 없음'이 구분되지 않는다.
    //   시트에 오늘 예정이 있는데 알림에 없으면 '개시 지연 또는 알림 누락 의심' WARN 배너로 표면화.
    //   (시트 개시일은 예정일 성격이라 ERROR가 아닌 WARN — 오탐 방지)
    let crossWarn = '';
    let crossStats = null;
    if (yeongchaRows) {
      const sheetToday = pickRowsForDates(yeongchaRows, [date]);
      const found = new Set(stations.flatMap(s => (s.projectIds || []).map(String)));
      const missing = sheetToday.filter(r => !found.has(String(r.projectId)));
      crossStats = { sheetToday: sheetToday.length, missingFromAlert: missing.length };
      if (missing.length) {
        const names = missing.slice(0, 8).map(r => r.projectName ?? r.projectId).join(', ');
        crossWarn = `⚠️ 영차영차 시트 기준 오늘 개시 예정 ${sheetToday.length}건 중 ${missing.length}건이 개시 알림에 없음 — 개시 지연 또는 알림 누락 의심: ${names}`;
        console.warn('[crosscheck]', crossWarn);
      } else {
        console.log(`[crosscheck] 시트 오늘 개시 ${sheetToday.length}건 — 알림 발견분과 전건 일치`);
      }
    }

    // 4. 체커 순회
    for (const s of stations) {
      try {
        // (테스트) 충전소 제외 — 온톨로지(proactive-fault-detection) 오탐 가드: "(테스트)소 제외".
        //   실사례: (테스트)롯데이노베이트 신관이 다구 커넥터 셀로 FAIL 오탐(2026-06-17).
        if (/\(\s*테스트\s*\)/.test(s.stationName ?? '')) {
          s.excluded = true;
          console.log(`  [exclude] (테스트) 충전소 제외: ${s.stationName}`);
          continue;
        }
        s.checks = {};
        // sheet 먼저 — 매칭 행의 projectName(E열)을 station에 채워 doc 키워드로 활용
        s.checks.sheet  = await safeRun('sheet',  () => checkSheet(s, ctx),  errors, s);
        s.projectName = s.checks.sheet.evidence?.projectName ?? null;
        // [HM] 프로젝트는 우리 알림 대상 아님 — projectId 기준 조회(주소 무관)로 견고하게 판정.
        //   checkSheet 주소 매칭이 실패(주소 null/부분매칭 오류)해도 projectId로 잡는다.
        const pnById = yeongchaRows ? findProjectNameByProjectIds(yeongchaRows, s.projectIds, date) : null;
        const pnForHm = pnById || s.projectName;
        if (isExcludedProject(pnForHm)) {
          s.excluded = true;
          console.log(`  [exclude] [HM] 프로젝트 제외: ${s.stationName ?? s.stationId} (${pnForHm})`);
          continue;
        }
        s.checks.doc     = await safeRun('doc',     () => checkDoc(s, ctx),    errors, s);
        s.checks.rate    = await safeRun('rate',    () => checkRate(s, ctx),   errors, s);
        s.checks.status  = await safeRun('status',  () => checkStatus(s, ctx), errors, s);
        // 서비스개시일자(충전기 테이블 맨 우측 열) 검증 — 공란·형식오류·미래날짜(순수 계산).
        s.checks.initdate = judgeInitDate(s, date);
        // 통신 판정 — 마지막 통신 시각(1h) 1차 + '통신 상태' 라벨 보조 (순수 계산, I/O 없음).
        s.checks.comm = judgeCommStatus(s, Date.now());
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

    // 4.6 자동 원격제어 — '미운영이지만 최근(1h) 통신 중'인 충전기를 운영으로 전환 + 재조회 확인.
    //     dryRun이면 후보만 보고(실제 제어 안 함). 대상 없으면 I/O 없이 즉시 통과.
    if (ctx) {
      const remRef = Date.now();
      for (const s of stations) {
        try {
          const rem = await remediateStation(ctx, s, { dryRun, referenceEpochMs: remRef });
          if (rem.targets > 0) {
            s.remediation = rem;
            const executed = rem.results.filter(r => r.executed).length;
            const okN = rem.results.filter(r => r.ok).length;
            console.log(`[remediate ${s.stationId}] 미운영+최근통신 ${rem.targets}건 → ${dryRun ? 'DRY RUN(미실행)' : `운영전환 성공 ${okN}/${executed}`}`);
          }
        } catch (e) {
          if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
          errors.push({ stationId: s.stationId, stage: 'remediate', error: (e?.message ?? String(e)).slice(0, 200) });
        }
      }
    }

    // 4.5 evening 슬롯: 다음 개시 예정 충전소 — 영차영차new BR 기재 확인 + 통신 상태 체크.
    //   대상 색인은 BR(nextTargetDates)로, 공문/요금제는 개시 전이라 생략.
    //   단, 각 충전소의 '정상 상태'(모든 충전기 마지막 통신 1시간 이내)는 미리 확인한다.
    //   주말엔 자동 실행이 없어, 내일이 주말이면 그 주말+다음 영업일까지 한 번에 커버. [HM] 제외.
    let tomorrowStations = [];
    let tomorrowSummary = null;
    if (slot === 'evening' && ctx) {
      try {
        const targetDates = nextTargetDates(date);
        const referenceEpochMs = Date.now();
        tomorrowStations = await discoverTomorrowStations(ctx.fetchSheetCsv, date);
        console.log(`[tomorrow] ${tomorrowStations.length} stations for ${targetDates.join(', ')} — 통신 1시간 상태 체크`);
        for (const p of tomorrowStations) {
          try {
            const stationId = await resolveStationIdByProjectId(ctx.browserContext, p.projectId, PLINKCONNECT_BASE);
            if (!stationId) {
              p.stationId = null;
              p.chargers = [];
              p.checks = { status: { status: 'SKIP', evidence: { reason: 'STATION_NOT_FOUND' }, message: 'stationId 조회 실패' } };
              p.overall = 'SKIP';
              errors.push({ projectId: p.projectId, stage: 'tomorrow_resolve', error: 'stationId not found' });
              continue;
            }
            const page = await ctx.browserContext.newPage();
            try {
              const data = await fetchStationData(page, stationId, PLINKCONNECT_BASE);
              p.stationId = stationId;
              p.stationName = data.stationName ?? p.projectName ?? null;
              p.address = data.address ?? p.address ?? null;
              p.chargers = data.chargers ?? [];
              p.referenceEpochMs = referenceEpochMs;
            } finally { await page.close(); }
            // 통신 상태만 체크 (마지막 통신 1시간 이내). 공문/요금제는 개시 전이라 생략.
            p.checks = { status: await safeRun('status', () => checkStatusRecent(p, ctx), errors, p) };
            p.overall = p.checks.status.status;
          } catch (e) {
            if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
            errors.push({ projectId: p.projectId, stage: 'tomorrow', error: (e?.message ?? String(e)).slice(0, 200) });
            p.checks = p.checks || {};
            p.overall = 'SKIP';
          }
        }
        tomorrowSummary = computeTomorrowSummary(tomorrowStations, targetDates);
      } catch (e) {
        if (e?.message === 'PLINKCONNECT_LOGIN_EXPIRED') throw e;
        console.error('[tomorrow] 실패:', e?.message ?? String(e));
        errors.push({ stage: 'tomorrow', error: (e?.message ?? String(e)).slice(0, 200) });
      }
    }

    // 4.8 개시 후 30일 정착 추적(settle) — 대시보드 전용(Slack 발송 없음).
    //     실패는 runSettle 내부에서 흡수(직전 성공분+error로 게시) — 기존 검증·알림·exit code 불변.
    if (settleOn && ctx) {
      const r = await runSettle({
        browserContext: ctx.browserContext,
        base: PLINKCONNECT_BASE,
        dashboardUrl, dataDir, date, slot
      });
      console.log(r.ok
        ? `[settle] 추적 이상 ${r.tracked}건 (신규 ${r.diff?.newEntries?.length ?? '-'} / 복구 ${r.diff?.recovered?.length ?? '-'}) → settle.json`
        : `[settle] 실패 — 대시보드 배너로 표시: ${r.error}`);
    }

    // 5. 알림 / 저장 — 서비스개시 충전소 유무로 분기.
    //   evening은 '다음날 개시 예정'도 0건이어야 빈 날로 본다(오후알림의 다음날 개시 포함).
    const summary = computeSummary(stations);
    const hasContent = stations.length > 0 || (slot === 'evening' && tomorrowStations.length > 0);
    const manifestPath = path.join(dataDir, 'index.json');
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : { slots: [] };
    let manifestEntry;
    // GitHub 백업 cron으로 실행됐는데 dedup에 안 걸리고 여기까지 왔다 = 정시 n8n 트리거가 이 슬롯을
    //   처리하지 못했다는 신호(장애 2·3 계열). 알림 상단에 경고를 노출해 능동 감지 가능하게 한다.
    const backupWarn = process.env.GITHUB_EVENT_NAME === 'schedule'
      ? '⚠️ 정시 n8n 트리거 미작동(또는 정시 실행 중도 실패) — GitHub 백업 cron으로 실행됨. n8n 발행상태·PAT 확인 필요.'
      : '';
    const banner = [backupWarn, crossWarn].filter(Boolean).join('\n');

    if (hasContent) {
      const out = {
        runAt: new Date().toISOString(),
        slot, date,
        sourceMessages: dedupeMessages(stations.map(s => ({
          ts: s.ts, permalink: s.permalink,
          stationLinks: s.stationId ? [`${PLINKCONNECT_BASE}/operation/stations/${s.stationId}/home`] : []
        }))),
        stations, summary,
        tomorrowStations, tomorrowSummary,
        errors: errors.map(sanitizeError)
      };
      const outFile = path.join(dataDir, `${date}-${slot}.json`);
      writeFileSync(outFile, JSON.stringify(out, null, 2));
      console.log(`[write] ${outFile}`);
      manifestEntry = { date, slot, file: `${date}-${slot}.json`, summary };

      // notify — DM + 채널(설정 시). 본문 Block Kit(가시성), text는 알림 fallback.
      const notifyArgs = { date, slot, summary, stations, tomorrowStations, tomorrowSummary, dashboardUrl };
      const notifyText = (banner ? banner + '\n\n' : '') + buildSummaryText(notifyArgs);
      const notifyBlocks = buildSummaryBlocks(notifyArgs);
      if (banner) notifyBlocks.unshift({ type: 'section', text: { type: 'mrkdwn', text: `*${banner}*` } });
      await sendDM({
        token: process.env.SLACK_BOT_TOKEN,
        userId: process.env.NOTIFY_SLACK_USER_ID,
        text: notifyText, blocks: notifyBlocks, dryRun
      });
      if (process.env.NOTIFY_SLACK_CHANNEL_ID) {
        // 원본 서비스개시 알림(8AM/5PM) ts에 스레드 답글. 없으면 채널 메인 fallback.
        const threadTs = out.sourceMessages?.[0]?.ts || undefined;
        try {
          await sendDM({
            token: process.env.SLACK_BOT_TOKEN,
            userId: process.env.NOTIFY_SLACK_CHANNEL_ID,
            text: notifyText, blocks: notifyBlocks, dryRun, threadTs
          });
        } catch (e) {
          console.error('[notify] 채널 발송 실패:', e?.message ?? String(e));
        }
      }
    } else {
      // 서비스개시 충전소 없음(쉬는날 등) — 쿠이 DM에만 통지(채널 X).
      //   manifest엔 empty 마커만 남겨 백업 cron이 중복 통지하지 않게 함(대시보드엔 미표시).
      console.log(`[empty] ${date} ${slot}: 서비스개시 충전소 없음 — DM만 통지 (today=${stations.length}${slot === 'evening' ? `, tomorrow=${tomorrowStations.length}` : ''})`);
      const slotKo = slot === 'morning' ? '오전' : '저녁';
      const crossNote = yeongchaLoadFailed
        ? '\n⚠️ 시트 로드 실패로 오늘개시 교차검증 미수행 — 백업 실행이 재시도합니다.'
        : (crossStats ? `\n(시트 교차검증: 오늘 개시 예정 ${crossStats.sheetToday}건)` : '');
      await sendDM({
        token: process.env.SLACK_BOT_TOKEN,
        userId: process.env.NOTIFY_SLACK_USER_ID,
        text: `${banner ? banner + '\n\n' : ''}🔌 서비스개시 검증 — ${date} ${slotKo}\n오늘 서비스개시 충전소가 없습니다. (검증 대상 없음)${crossNote}`,
        dryRun
      });
      if (yeongchaLoadFailed) {
        // 교차검증 미수행 상태로 '개시 0건'을 확정하지 않는다 — empty 마커를 게시하지 않아
        //   백업 cron이 dedup에 안 걸리고 재시도하게 하고, 워크플로는 실패로 표시한다.
        console.error('[empty] 시트 로드 실패 — empty 마커 미게시(백업 재시도 허용) + exitCode=1');
        process.exitCode = 1;
        manifestEntry = null;
      } else {
        manifestEntry = { date, slot, empty: true, summary: { totalStations: 0 }, ...(crossStats ? { crossCheck: crossStats } : {}) };
      }
    }

    // 6. manifest 갱신 + retention + 배포 — 빈 날도 마커를 게시해 백업 cron이 dedup으로 skip.
    //    (manifestEntry가 null이면 = 확정 불가 상태 — 게시·배포 자체를 생략해 재시도를 허용)
    if (manifestEntry) {
    const newManifest = upsertManifest(manifest, manifestEntry, { retentionDays: RETENTION_DAYS, today: date });
    writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
    pruneDataDir(dataDir, { retentionDays: RETENTION_DAYS, today: date });

    if (!dryRun) {
      try {
        // CI(GitHub Actions 등)에선 VERCEL_TOKEN 으로 비대화식 인증. 로컬은 로그인 세션 사용.
        const tokenArg = process.env.VERCEL_TOKEN ? ` --token=${process.env.VERCEL_TOKEN}` : '';
        execSync(`npx vercel deploy --prod --yes${tokenArg}`, { cwd: __dirname, stdio: 'inherit' });
      } catch (e) {
        // 배포 실패를 조용히 넘기지 않는다: 대시보드 정체 + dedup 마커 미게시(→ 백업 cron 중복 발송) 유발.
        const tok = process.env.VERCEL_TOKEN;
        const msg = tok ? String(e?.message ?? e).split(tok).join('***') : String(e?.message ?? e); // 토큰 평문 노출 방지
        console.error('[audit] Vercel 배포 실패:', msg);
        try {
          await sendDM({
            token: process.env.SLACK_BOT_TOKEN,
            userId: process.env.NOTIFY_SLACK_USER_ID,
            text: `⚠️ [${date} ${slot}] 대시보드 배포 실패 — 대시보드 미갱신. VERCEL_TOKEN·네트워크 확인 필요. (검증 결과 자체는 정상 산출·발송됨; dedup 마커 미게시로 백업 cron이 중복 발송할 수 있음)`,
            dryRun: false
          });
        } catch { /* DM 실패는 무시 — exitCode로 워크플로가 붉게 표시됨 */ }
        process.exitCode = 1;
      }
    }
    } // end: if (manifestEntry)
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

function computeTomorrowSummary(previews, dates) {
  const byOverall = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const s of previews) {
    if (s.overall) byOverall[s.overall] = (byOverall[s.overall] || 0) + 1;
  }
  return { totalStations: previews.length, dates, byOverall };
}

function computeSummary(stations) {
  const byOverall = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  const byCheck = { doc: {}, rate: {}, status: {}, sheet: {}, initdate: {}, comm: {} };
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

  // 구글 인증: 시트·Gmail 분리. (lib/google_auth.js 참고)
  //   - 시트: GOOGLE_SA_KEY 있으면 Sheets API(브라우저 세션 불필요, CI 대응), 없으면 브라우저 gviz.
  //   - Gmail: 도메인위임(GOOGLE_DELEGATION=1)이면 SA, 아니면 OAuth 리프레시 토큰.
  const { sheetsMode, gmailMode, sheetsAuth, gmailAuth } = buildGoogleAuth();
  const oauth2Client = gmailAuth; // google.gmail({auth}) — JWT/OAuth2 모두 호환
  const saSheetsFetch = sheetsMode === 'sa' ? makeSheetsCsvFetcher(sheetsAuth) : null;
  console.log(`[auth] sheets=${sheetsMode} gmail=${gmailMode}`);

  const fetchSheetCsv = async (url) => {
    // SA 모드: Sheets API로 받아 gviz 호환 CSV로 직렬화 (브라우저 세션 불필요).
    if (saSheetsFetch) return saSheetsFetch(url);
    // 레거시: 로그인된 docs.google.com 세션에서 gviz CSV fetch.
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
