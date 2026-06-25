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
