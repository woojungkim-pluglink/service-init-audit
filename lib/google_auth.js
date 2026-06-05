import { google } from 'googleapis';

// 서비스계정/OAuth 공통 구글 인증 + 시트 읽기.
//   - GOOGLE_SA_KEY(서비스계정 JSON)가 있으면 서비스계정 모드:
//       도메인 위임 + GMAIL_USER 임퍼소네이션으로 시트(비공개)·Gmail 모두 접근.
//   - 없으면 레거시 OAuth2(리프레시 토큰) 모드 — 시트는 audit.js의 브라우저 gviz fetch로.
//
// CLAUDE.md 메모: GitHub Actions 러너엔 로그인된 docs.google.com 세션이 없어
//   브라우저 gviz fetch가 'Failed to fetch'로 실패 → 서비스계정으로 대체.

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function oauthClient(env) {
  const o = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
  return o;
}

/**
 * 시트·Gmail 인증을 분리해서 생성. 환경에 맞춰 모드 자동 결정.
 *
 *   GOOGLE_SA_KEY  : 서비스계정 JSON (있으면 시트를 API로 — CI에서 로그인 세션 불필요).
 *   GOOGLE_DELEGATION=1 : 도메인 전체 위임이 설정된 경우만 켠다.
 *        켜짐 → 시트·Gmail 모두 SA로 GMAIL_USER 임퍼소네이션.
 *        꺼짐(기본) → 시트는 SA로 "공유받은" 시트 접근(임퍼소네이션 X),
 *                     Gmail은 OAuth 리프레시 토큰 사용(서비스계정은 위임 없이 메일함 접근 불가).
 *
 * @returns {{ sheetsMode:'sa'|'browser', gmailMode:'sa'|'oauth', sheetsAuth: object|null, gmailAuth: object }}
 */
export function buildGoogleAuth(env = process.env) {
  const hasSA = !!env.GOOGLE_SA_KEY;
  const useDelegation = env.GOOGLE_DELEGATION === '1' || env.GOOGLE_DELEGATION === 'true';
  const creds = hasSA ? JSON.parse(env.GOOGLE_SA_KEY) : null;

  // 시트 인증
  let sheetsAuth = null;
  if (hasSA) {
    sheetsAuth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [SHEETS_SCOPE],
      subject: useDelegation ? (env.GMAIL_USER || undefined) : undefined // 위임 없으면 공유 기반
    });
  }

  // Gmail 인증
  let gmailAuth, gmailMode;
  if (hasSA && useDelegation) {
    gmailAuth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [GMAIL_SCOPE],
      subject: env.GMAIL_USER
    });
    gmailMode = 'sa';
  } else {
    gmailAuth = oauthClient(env); // 위임 불가 → OAuth 리프레시 토큰
    gmailMode = 'oauth';
  }

  return {
    sheetsMode: hasSA ? 'sa' : 'browser',
    gmailMode,
    sheetsAuth,
    gmailAuth
  };
}

/**
 * 행(셀 배열)들을 gviz와 동일한 형태의 CSV 텍스트로 직렬화.
 *   - 콤마/따옴표/개행 포함 셀만 따옴표 처리(내부 " 는 "" 로 escape).
 *   - ragged(행마다 길이 다름) 그대로 유지 — 기존 parseGvizCsv 소비부가 (row[i]||'')로 가드.
 */
export function rowsToCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return (rows || []).map((r) => (r || []).map(esc).join(',')).join('\n');
}

/** 시트 URL에서 spreadsheetId·gid 추출 */
export function parseSheetUrl(url) {
  const spreadsheetId = url.match(/spreadsheets\/d\/([^/]+)/)?.[1] || null;
  const gid = url.match(/[?&]gid=(\d+)/)?.[1] ?? null;
  return { spreadsheetId, gid };
}

/**
 * 서비스계정 auth로 gviz URL과 동일한 결과(CSV 텍스트)를 반환하는 fetcher 생성.
 * gid → 탭 제목 매핑은 스프레드시트별 1회 조회 후 캐시.
 * @param {object} auth google.auth.JWT (또는 OAuth2)
 * @returns {(url: string) => Promise<string>}
 */
export function makeSheetsCsvFetcher(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const titleCache = {}; // spreadsheetId -> { [gid]: title }
  return async (url) => {
    const { spreadsheetId, gid } = parseSheetUrl(url);
    if (!spreadsheetId || gid == null) throw new Error(`시트 URL 파싱 실패: ${url}`);
    if (!titleCache[spreadsheetId]) {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
      });
      const m = {};
      for (const s of meta.data.sheets || []) {
        m[String(s.properties.sheetId)] = s.properties.title;
      }
      titleCache[spreadsheetId] = m;
    }
    const title = titleCache[spreadsheetId][String(gid)];
    if (!title) throw new Error(`gid=${gid} 시트 탭 없음 (spreadsheet ${spreadsheetId})`);
    const range = `'${title.replace(/'/g, "''")}'`; // 전체 탭
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',      // 표시값 = gviz와 동일 (날짜 'YYYY-MM-DD' 등)
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    return rowsToCsv(resp.data.values || []);
  };
}
