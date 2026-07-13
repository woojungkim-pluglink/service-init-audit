import { google } from 'googleapis';

/** "이름 <email>" 또는 "email" 문자열에서 순수 이메일만 소문자로 추출 */
export function extractEmailAddr(s) {
  return (String(s || '').match(/<([^>]+)>/)?.[1] || s || '').trim().toLowerCase();
}

/**
 * 이메일 로컬파트를 앞 2자만 남기고 마스킹. 대시보드 JSON은 무인증 공개라 PII 최소화.
 *   "daeyeol.yang@pluglink.kr" → "da***@pluglink.kr"
 */
export function maskEmail(s) {
  const addr = extractEmailAddr(s);
  const at = addr.indexOf('@');
  if (at <= 0) return addr ? '***' : '';
  const local = addr.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${addr.slice(at)}`;
}

/** 두 문자열의 최장 공통 부분문자열 길이 (짧은 입력용 O(n*m) DP) */
export function longestCommonSubstringLen(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return 0;
  let prev = new Array(b.length + 1).fill(0), best = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    }
    prev = cur;
  }
  return best;
}

const LCS_MIN = 6; // 이름 계열 키워드와 제목의 공통부분 6자 이상이면 표기차로 보고 매칭

export function matchEmails(threads, { keywords, pmEmails, myEmail, groupEmails = [] }) {
  const pmSet = new Set(pmEmails.map(e => e.toLowerCase()));
  // cc 인정 대상: 본인 이메일 + 그룹 메일들 (예: pm@pluglink.kr)
  const ccAcceptSet = new Set([myEmail, ...groupEmails].filter(Boolean).map(e => e.toLowerCase()));

  // 이름 계열 키워드(주소 제외 = 공백 없는 것)만 LCS 대상 — 접두(지역명)·접미(N단지) 생략 표기차 대응.
  //   예: 키워드 "김포힐스테이트리버시티1단지" ↔ 메일 제목 "힐스테이트리버시티…" → 공통 9자 매칭.
  const nameLike = keywords.filter(k => k && !/\s/.test(k) && k.length >= 4);
  const fromPM = threads.filter(t => pmSet.has(extractEmailAddr(t.from)));
  const matchedKeyword = (t) => {
    const hay = `${t.subject || ''}\n${t.snippet || ''}`;
    if (keywords.some(k => hay.includes(k))) return true;                 // 정확 부분일치(기존)
    return nameLike.some(k => longestCommonSubstringLen(k, hay) >= LCS_MIN); // 표기차 대응(신규)
  };

  // To 또는 Cc에 본인/그룹 메일이 있으면 참조 인정 (PM은 보통 To에 "PM팀" <pm@pluglink.kr> 포함)
  const recipientHasGroup = (t) =>
    (t.cc || []).some(c => ccAcceptSet.has(extractEmailAddr(c)))
    || (t.to || []).some(c => ccAcceptSet.has(extractEmailAddr(c)));

  const withCC = fromPM.filter(t => recipientHasGroup(t) && matchedKeyword(t));

  if (withCC.length >= 1) {
    return {
      status: 'PASS',
      evidence: {
        // 공개 대시보드 PII 최소화: 외부 고객 to/cc는 게시 안 함, 발신은 마스킹. 원본은 gmailUrl로 확인.
        matchedEmails: withCC.map(t => ({
          id: t.id, threadId: t.threadId ?? t.id,
          subject: t.subject, from: maskEmail(t.from), date: t.date,
          gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${t.threadId ?? t.id}`
        })),
        queriedKeywords: keywords
      },
      message: `PM ${withCC[0].from.split('@')[0]} 발송 (cc 확인), ${withCC.length}건`
    };
  }

  const withoutCC = fromPM.filter(t => matchedKeyword(t) && !recipientHasGroup(t));
  if (withoutCC.length >= 1) {
    return {
      status: 'WARN',
      evidence: {
        matchedEmails: withoutCC.map(t => ({
          id: t.id, threadId: t.threadId ?? t.id,
          subject: t.subject, from: maskEmail(t.from), date: t.date
        })),
        queriedKeywords: keywords
      },
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
 * KST-safe 날짜 빼기. iso는 'YYYY-MM-DD'.
 */
export function subtractDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

/**
 * 실제 Gmail에서 스레드 메타데이터 가져오기.
 * 반환: threadId 포함 (Gmail web URL은 threadId 사용).
 */
export async function fetchGmailThreads({ oauth2Client, pmEmails, sinceDate, groupEmails = [] }) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const fromQuery = pmEmails.map(e => `from:${e}`).join(' OR ');
  // To/Cc 둘 다 후보로. Gmail은 to:/cc: 쿼리가 있고, 합치면 too restrictive할 수 있어
  // 일단 from만으로 fetch 후 client-side에서 to/cc 검사. maxResults를 키워서 누락 줄임.
  const q = `(${fromQuery}) after:${sinceDate.replace(/-/g, '/')}`;
  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 500 });
  const messages = res.data.messages || [];
  const detailed = [];
  for (const m of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me', id: m.id, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date']
    });
    const headers = Object.fromEntries((full.data.payload.headers || []).map(h => [h.name, h.value]));
    detailed.push({
      id: m.id,
      threadId: full.data.threadId,
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

/** projectName에서 의미있는 토큰 추출. "25년환경부_현대2차아파트_1차" → ["현대2차아파트"] 등.
 *  너무 짧거나(<3) "_차" 같은 노이즈는 제외. */
export function projectNameTokens(name) {
  if (!name) return [];
  return name
    .split(/[_\s]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !/^\d+차$/.test(t) && !/^\d+년/.test(t));
}

const BUILDING_SUFFIX_RE = /(아파트먼트|아파트|APT|맨션|빌라|연립|오피스텔|타운|단지)$/i;

/**
 * 단지명 표기 차이를 흡수한 검색어 변형 생성.
 *   PM 공문 제목은 차수 위치·건물 유형 표기가 시트와 다른 경우가 많다.
 *     "창포2차아이파크" → 메일 "창포아이파크2차"   (차수 위치)
 *     "가곡시영맨션"   → 메일 "가곡시영APT"        (맨션 vs APT)
 *   → 차수(\d+차) 제거형, 건물 접미사 제거형을 함께 키워드로 둬 부분일치율을 높인다.
 * @param {string} name
 * @returns {string[]}
 */
export function nameVariants(name) {
  if (!name) return [];
  const base = String(name).trim();
  const noChasu = base.replace(/\d+\s*차/g, '').trim(); // 차수 토큰 제거
  const set = new Set([base, noChasu]);
  for (const v of [base, noChasu]) {
    const stripped = v.replace(BUILDING_SUFFIX_RE, '').trim(); // 건물 유형 접미사 제거
    if (stripped) set.add(stripped);
  }
  return [...set].filter(s => s.length >= 2);
}

export async function checkDoc(station, ctx) {
  const sinceDate = subtractDays(station.initiatedAt, 30);
  const threads = await fetchGmailThreads({
    oauth2Client: ctx.gmail,
    pmEmails: ctx.pmEmails,
    sinceDate,
    groupEmails: ctx.groupEmails
  });
  const addrFirstChunk = (station.address || '').split(/\s+/).slice(0, 3).join(' ');
  // 충전소명 + 영차영차 시트 E열 프로젝트명 토큰 → 각각 표기 변형(차수/접미사) 포함 + 주소 첫 부분.
  const pTokens = projectNameTokens(station.projectName);
  const nameKeys = [station.stationName, ...pTokens].filter(Boolean).flatMap(nameVariants);
  const keywords = [...new Set(
    [...nameKeys, addrFirstChunk].filter(Boolean)
  )];
  return matchEmails(threads, {
    keywords,
    pmEmails: ctx.pmEmails,
    myEmail: ctx.myEmail,
    groupEmails: ctx.groupEmails
  });
}
