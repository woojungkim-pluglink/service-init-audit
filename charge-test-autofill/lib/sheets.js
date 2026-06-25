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
