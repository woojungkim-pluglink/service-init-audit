import { google } from 'googleapis';

export function matchEmails(threads, { keywords, pmEmails, myEmail }) {
  const pmSet = new Set(pmEmails.map(e => e.toLowerCase()));
  const myEmailLower = myEmail.toLowerCase();

  const fromPM = threads.filter(t => pmSet.has(t.from.toLowerCase()));
  const matchedKeyword = (t) => keywords.some(k =>
    (t.subject || '').includes(k) || (t.snippet || '').includes(k)
  );

  const withCC = fromPM.filter(t =>
    (t.cc || []).some(c => c.toLowerCase() === myEmailLower) && matchedKeyword(t)
  );

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

  const withoutCC = fromPM.filter(matchedKeyword);
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
export async function fetchGmailThreads({ oauth2Client, pmEmails, sinceDate }) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const fromQuery = pmEmails.map(e => `from:${e}`).join(' OR ');
  const q = `(${fromQuery}) cc:me after:${sinceDate.replace(/-/g, '/')}`;
  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100 });
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

export async function checkDoc(project, ctx) {
  const sinceDate = subtractDays(project.initiatedAt, 30);
  const threads = await fetchGmailThreads({
    oauth2Client: ctx.gmail,
    pmEmails: ctx.pmEmails,
    sinceDate
  });
  return matchEmails(threads, {
    keywords: [project.projectName, project.stationName].filter(Boolean),
    pmEmails: ctx.pmEmails,
    myEmail: ctx.myEmail
  });
}
