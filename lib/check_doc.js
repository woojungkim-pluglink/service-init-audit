import { google } from 'googleapis';

export function matchEmails(threads, { keywords, pmEmails, myEmail, groupEmails = [] }) {
  const pmSet = new Set(pmEmails.map(e => e.toLowerCase()));
  // cc 인정 대상: 본인 이메일 + 그룹 메일들 (예: pm@pluglink.kr)
  const ccAcceptSet = new Set([myEmail, ...groupEmails].filter(Boolean).map(e => e.toLowerCase()));

  const fromPM = threads.filter(t => pmSet.has(t.from.toLowerCase()));
  const matchedKeyword = (t) => keywords.some(k =>
    (t.subject || '').includes(k) || (t.snippet || '').includes(k)
  );

  // To 또는 Cc에 본인/그룹 메일이 있으면 참조 인정 (PM은 보통 To에 PM팀 그룹 포함)
  const recipientHasGroup = (t) =>
    (t.cc || []).some(c => ccAcceptSet.has(c.toLowerCase()))
    || (t.to || []).some(c => ccAcceptSet.has(c.toLowerCase()));

  const withCC = fromPM.filter(t => recipientHasGroup(t) && matchedKeyword(t));

  if (withCC.length >= 1) {
    return {
      status: 'PASS',
      evidence: {
        matchedEmails: withCC.map(t => ({
          id: t.id, threadId: t.threadId ?? t.id,
          subject: t.subject, from: t.from,
          to: t.to, cc: t.cc, date: t.date,
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
          subject: t.subject, from: t.from, date: t.date
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

export async function checkDoc(station, ctx) {
  const sinceDate = subtractDays(station.initiatedAt, 30);
  const threads = await fetchGmailThreads({
    oauth2Client: ctx.gmail,
    pmEmails: ctx.pmEmails,
    sinceDate,
    groupEmails: ctx.groupEmails
  });
  // 충전소명과 주소(첫 부분)를 키워드로
  const addrFirstChunk = (station.address || '').split(/\s+/).slice(0, 3).join(' ');
  return matchEmails(threads, {
    keywords: [station.stationName, addrFirstChunk].filter(Boolean),
    pmEmails: ctx.pmEmails,
    myEmail: ctx.myEmail,
    groupEmails: ctx.groupEmails
  });
}
