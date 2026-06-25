import 'dotenv/config';
import { extractTicketId, decideWrite } from './lib/logic.js';
import { login, getTicket } from './lib/pluglink.js';
import { getSheetsClient, readTab, writeCells, resolveTabTitle } from './lib/sheets.js';
import { sendSummary } from './lib/notify.js';

const J_COL = 9;    // 0-base: J = OnM 보완완료일자
const M_COL = 12;   // 0-base: M = 25년환경부_준공보완_충전테스트
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
