/**
 * service-init-audit 트리거 웹훅 서버 (클라우드 컨테이너용).
 * n8n Schedule 노드가 이 엔드포인트를 호출 → audit.js 실행. PC 의존 제거.
 *
 *   POST /run?slot=morning|evening   헤더 x-trigger-secret: <TRIGGER_SECRET>
 *     → audit.js를 백그라운드로 실행하고 202 즉시 반환 (audit는 ~20분 소요).
 *   GET  /health                      → 200 ok
 *
 * 환경변수:
 *   TRIGGER_SECRET   (필수) n8n과 공유하는 시크릿. 일치해야 실행.
 *   PORT             (기본 8080)
 *   그 외 audit 동작용: PLINKCONNECT_USERNAME/PASSWORD, SLACK_BOT_TOKEN,
 *     NOTIFY_SLACK_*, GMAIL_*, VERCEL 배포용 토큰 등 — config/.env 또는 컨테이너 env.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, createWriteStream } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.TRIGGER_SECRET || '';

let running = false; // 동시 실행 방지 (chrome_profile 단일 세션 충돌 방지)

function runAudit(slot) {
  running = true;
  mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(ROOT, 'logs', `webhook-${slot}-${stamp}.log`);
  const out = createWriteStream(logPath);
  const child = spawn('node', ['audit.js', `--slot=${slot}`], { cwd: ROOT, env: process.env });
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on('close', (code) => { running = false; console.log(`[webhook] audit ${slot} exited code=${code} log=${logPath}`); });
  child.on('error', (e) => { running = false; console.error('[webhook] spawn error', e?.message); });
  return logPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, running }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/run') {
    if (!SECRET || req.headers['x-trigger-secret'] !== SECRET) {
      res.writeHead(401); res.end('unauthorized'); return;
    }
    const slot = url.searchParams.get('slot');
    if (slot !== 'morning' && slot !== 'evening') {
      res.writeHead(400); res.end('slot must be morning|evening'); return;
    }
    if (running) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'audit already running' }));
      return;
    }
    const logPath = runAudit(slot);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, slot, started: true, log: logPath }));
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`[webhook] listening on :${PORT} (POST /run?slot=, GET /health)`));
