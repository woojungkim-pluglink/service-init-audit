/**
 * Gmail OAuth refresh_token 획득 헬퍼.
 *
 * 사전조건:
 *   - config/.env 에 GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET 가 채워져 있어야 함
 *   - Google Cloud Console의 OAuth 클라이언트 "승인된 리디렉션 URI"에
 *     http://localhost:8080/callback 등록되어 있어야 함
 *
 * 실행:
 *   node scripts/gmail_oauth.js
 *
 * 동작:
 *   1. 로컬 서버를 8080 포트에 띄움
 *   2. Google OAuth consent URL을 콘솔에 출력 (Windows에서는 브라우저 자동 시도)
 *   3. 사용자가 동의하면 /callback 으로 code 수신
 *   4. token exchange → refresh_token을 콘솔에 출력
 *   5. 출력된 refresh_token을 config/.env의 GMAIL_REFRESH_TOKEN= 에 붙여넣기
 */
import 'dotenv/config';
import { google } from 'googleapis';
import http from 'node:http';
import { exec } from 'node:child_process';

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.metadata'
];

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ config/.env 에 GMAIL_CLIENT_ID 와 GMAIL_CLIENT_SECRET 가 모두 채워져 있어야 합니다.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',          // 매번 refresh_token이 발급되도록 강제 동의
  scope: SCOPES,
});

console.log('\n────────────────────────────────────────────────');
console.log(' 브라우저에서 아래 URL을 열어 Google 동의 절차를 진행하세요:');
console.log('────────────────────────────────────────────────\n');
console.log(authUrl + '\n');

// Windows에서 기본 브라우저로 자동 열기 (실패해도 무시)
try { exec(`start "" "${authUrl}"`); } catch { /* ignore */ }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
       .end(`<h1>OAuth 에러</h1><p>${errParam}</p>`);
    console.error(`\n❌ OAuth 에러: ${errParam}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400).end('no code');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
         .end(`<h1>⚠️ refresh_token 없음</h1>
               <p>이미 이 앱에 동의한 적이 있어 refresh_token이 발급되지 않았습니다.</p>
               <p><a href="https://myaccount.google.com/permissions">Google 계정 → 권한 관리</a>에서 이 앱을 제거하고 다시 시도하세요.</p>`);
      console.error('\n❌ refresh_token 없음.');
      console.error('  Google 계정 → 보안 → 타사 앱 액세스 → 이 앱 제거 후 재실행 필요.');
      console.error('  https://myaccount.google.com/permissions\n');
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
       .end('<h1>✅ 성공</h1><p>이 창을 닫고 터미널을 확인하세요.</p>');

    console.log('\n────────────────────────────────────────────────');
    console.log(' ✅ refresh_token 획득 성공');
    console.log('────────────────────────────────────────────────\n');
    console.log(tokens.refresh_token);
    console.log('\n위 값을 config/.env 의 다음 줄에 붙여넣으세요:');
    console.log('GMAIL_REFRESH_TOKEN=<위_값>\n');

    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' })
       .end('token exchange 실패: ' + (e?.message ?? String(e)));
    console.error('\n❌ token exchange 실패:', e?.message ?? e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`[gmail_oauth] http://localhost:${PORT} 대기 중...`);
  console.log('  Ctrl+C로 중단 가능\n');
});
