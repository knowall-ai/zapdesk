// Full, read-only export of a Zendesk account, for review and for
// scripts/zendesk-import.ts.
//
//   node scripts/zendesk-export.mjs --config <file>
//
// The config file (see scripts/zendesk-import.config.example.json) names the
// Zendesk subdomain, a read-only OAuth client, the file holding its secret and
// the folder to write. It holds real values, so keep it outside the repo, and
// keep the export folder outside it too: the export is customer data.
//
// Writes, under exportDir:
//   raw/            the complete API responses (tickets, comments, users, ...)
//   attachments/    every attachment, one folder per ticket
//   zendesk-export.xlsx   Summary, Tickets, Comments, Attachments, People
//
// Nothing in Zendesk is changed. The secret and token are never printed.
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const configAt = process.argv.indexOf('--config');
if (configAt < 0 || !process.argv[configAt + 1]) {
  console.error('Usage: node scripts/zendesk-export.mjs --config <file>');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(process.argv[configAt + 1], 'utf8'));
const subdomain = config.zendeskSubdomain;
const clientId = config.zendeskClientId;
const secretFile = config.zendeskSecretFile;
const outDir = config.exportDir;
const secret = fs.readFileSync(secretFile, 'utf8').trim();
const base = `https://${subdomain}.zendesk.com`;
const rawDir = path.join(outDir, 'raw');
const attDir = path.join(outDir, 'attachments');
fs.mkdirSync(path.join(rawDir, 'comments'), { recursive: true });
fs.mkdirSync(attDir, { recursive: true });

// --- auth ------------------------------------------------------------------
let token = null;
/** A new read-only token, within its own deadline. */
async function newToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    token = await requestToken(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new Error('token request: no answer within 60s');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function requestToken(signal) {
  const r = await fetch(`${base}/oauth/tokens`, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
      scope: 'read',
      expires_in: 7200,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) throw new Error(`token request failed: HTTP ${r.status}`);
  return body.access_token;
}

/** The longest rate-limit wait honoured; a longer Retry-After stops the export instead. */
const MAX_RETRY_WAIT_S = 120;

/** Seconds to wait from a Retry-After header: whole seconds, 1 to MAX_RETRY_WAIT_S. */
function retryWait(header) {
  const value = String(header ?? '10').trim();
  if (!/^\d+$/.test(value)) return 10;
  const seconds = Math.max(1, Number.parseInt(value, 10));
  if (seconds > MAX_RETRY_WAIT_S) {
    throw new Error(`Zendesk asks to wait ${seconds}s (rate limit); run the export again later`);
  }
  return seconds;
}

// The token only ever goes over HTTPS to Zendesk itself: the subdomain, or a
// configured host-mapped domain. An attachment's content_url can point at an
// external host, and Zendesk redirects downloads to pre-signed links on its file
// host; neither gets the token (#704 review).
const tokenHosts = new Set(
  [new URL(base).host, ...(config.zendeskImageHosts ?? [])].map((h) => h.toLowerCase())
);
const sendsToken = (u) => u.protocol === 'https:' && tokenHosts.has(u.host.toLowerCase());

/** A deadline covering the whole request, body included. */
const DEADLINE_MS = 120_000;

/**
 * GET as JSON (or the raw bytes). Renews an expired token once and waits out
 * rate limits, each counted on its own, and follows redirects by hand so each
 * hop is HTTPS and only token hosts see the token.
 */
async function get(url, { raw = false } = {}) {
  let target = new URL(url.startsWith('http') ? url : `${base}${url}`);
  let renewed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (target.protocol !== 'https:')
      throw new Error(`refusing ${target.protocol} URL (${target.host})`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    try {
      const headers = sendsToken(target) ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(target, { headers, redirect: 'manual', signal: controller.signal });
      const location = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && location) {
        target = new URL(location, target);
        continue;
      }
      if (r.status === 401 && !renewed && sendsToken(target)) {
        renewed = true;
        clearTimeout(timer); // renewal and backoff have deadlines of their own
        await newToken();
        continue;
      }
      if (r.status === 429) {
        const wait = retryWait(r.headers.get('retry-after'));
        clearTimeout(timer);
        await new Promise((res) => setTimeout(res, wait * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`GET ${target.host}${target.pathname} -> ${r.status}`);
      return raw ? Buffer.from(await r.arrayBuffer()) : await r.json();
    } catch (e) {
      if (controller.signal.aborted)
        throw new Error(`GET ${target.host}${target.pathname}: no answer in time`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`GET ${target.host}${target.pathname} kept failing`);
}

/** Every item of a list endpoint, by cursor pagination (offset paging stops at 10,000). */
async function getAll(url, key) {
  const items = [];
  let next = url;
  while (next) {
    const page = await get(next);
    items.push(...(page[key] ?? []));
    next = page.meta?.has_more ? page.links?.next : null;
  }
  return items;
}

const save = (name, data) =>
  fs.writeFileSync(path.join(rawDir, name), JSON.stringify(data, null, 2));

// --- export ----------------------------------------------------------------
await newToken();
console.log('signed in');

const tickets = [];
const users = new Map();
const orgs = new Map();
let url = `/api/v2/incremental/tickets/cursor.json?start_time=0&include=users,organizations,groups`;
const groups = new Map();
for (;;) {
  const page = await get(url);
  tickets.push(...page.tickets);
  for (const u of page.users ?? []) users.set(u.id, u);
  for (const o of page.organizations ?? []) orgs.set(o.id, o);
  for (const g of page.groups ?? []) groups.set(g.id, g);
  if (page.end_of_stream) break;
  url = page.after_url;
}
console.log(`tickets: ${tickets.length}`);

const ticketFields = await getAll('/api/v2/ticket_fields.json?page[size]=100', 'ticket_fields');
for (const o of await getAll('/api/v2/organizations.json?page[size]=100', 'organizations')) {
  orgs.set(o.id, o);
}
for (const g of await getAll('/api/v2/groups.json?page[size]=100', 'groups')) groups.set(g.id, g);

const live = tickets.filter((t) => t.status !== 'deleted').sort((a, b) => a.id - b.id);

// Comments, with their authors, and attachments.
const commentsByTicket = new Map();
const attachments = [];
let n = 0;
for (const t of live) {
  const comments = [];
  let next = `/api/v2/tickets/${t.id}/comments.json?include=users&include_inline_images=true&page[size]=100`;
  while (next) {
    const page = await get(next);
    comments.push(...page.comments);
    for (const u of page.users ?? []) users.set(u.id, u);
    next = page.meta?.has_more ? page.links?.next : null;
  }
  commentsByTicket.set(t.id, comments);
  fs.writeFileSync(
    path.join(rawDir, 'comments', `${t.id}.json`),
    JSON.stringify(comments, null, 2)
  );
  for (const c of comments) {
    for (const a of c.attachments ?? []) {
      const safe = `${a.id}-${a.file_name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150);
      const dir = path.join(attDir, String(t.id));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, safe);
      let saved = 'yes';
      if (!fs.existsSync(file)) {
        // Written beside the final name and renamed once complete, so a failed
        // download never leaves a partial file a rerun would take as done.
        const partial = `${file}.partial`;
        try {
          fs.writeFileSync(partial, await get(a.content_url, { raw: true }));
          fs.renameSync(partial, file);
        } catch (e) {
          fs.rmSync(partial, { force: true });
          saved = `failed: ${String(e.message).slice(0, 80)}`;
        }
      }
      attachments.push({
        ticket: t.id,
        comment: c.id,
        name: a.file_name,
        type: a.content_type,
        size: a.size,
        inline: Boolean(a.inline),
        // Matches an inline picture to the <img> that shows it, at import.
        url: a.content_url,
        saved,
        file: path.relative(outDir, file),
      });
    }
  }
  if (++n % 20 === 0) console.log(`comments: ${n}/${live.length}`);
}

save('tickets.json', tickets);
save('users.json', [...users.values()]);
save('organizations.json', [...orgs.values()]);
save('groups.json', [...groups.values()]);
save('ticket_fields.json', ticketFields);
save('attachments.json', attachments);
console.log(`comments done; attachments: ${attachments.length}`);

// --- workbook ----------------------------------------------------------------
const userName = (id) => (id ? (users.get(id)?.name ?? `user ${id}`) : '');
const userEmail = (id) => (id ? (users.get(id)?.email ?? '') : '');
const domainOf = (email) => (email.includes('@') ? email.split('@')[1].toLowerCase() : '');
const fieldTitle = new Map(ticketFields.map((f) => [f.id, f.title]));
const date = (s) => (s ? new Date(s) : null);

// The configured project for each domain, for whoever reviews the export to confirm.
const SUGGESTED = config.projects ?? {};

const wb = new ExcelJS.Workbook();
wb.creator = 'Zendesk export';
wb.created = new Date();

function sheet(name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

// Summary is the first tab; it is filled in once the other sheets exist.
const sum = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF4D7C0F' } } });

const ticketRows = live.map((t) => {
  const email = userEmail(t.requester_id);
  const domain = domainOf(email);
  const comments = commentsByTicket.get(t.id) ?? [];
  return {
    id: t.id,
    subject: t.subject ?? '',
    status: t.status,
    priority: t.priority ?? '',
    type: t.type ?? '',
    channel: t.via?.channel ?? '',
    requester: userName(t.requester_id),
    requesterEmail: email,
    domain,
    organisation: t.organization_id ? (orgs.get(t.organization_id)?.name ?? '') : '',
    suggested: SUGGESTED[domain] ?? '?',
    assignee: userName(t.assignee_id),
    group: t.group_id ? (groups.get(t.group_id)?.name ?? '') : '',
    tags: (t.tags ?? []).join(', '),
    created: date(t.created_at),
    updated: date(t.updated_at),
    replies: comments.filter((c) => c.public).length,
    notes: comments.filter((c) => !c.public).length,
    attachments: comments.reduce((s, c) => s + (c.attachments?.length ?? 0), 0),
    customFields: (t.custom_fields ?? [])
      .filter((f) => f.value !== null && f.value !== false && f.value !== '')
      .map((f) => `${fieldTitle.get(f.id) ?? f.id}: ${f.value}`)
      .join('; '),
    description: (t.description ?? '').slice(0, 32000),
  };
});

sheet(
  'Tickets',
  [
    { header: 'Zendesk #', key: 'id', width: 10 },
    { header: 'Subject', key: 'subject', width: 50 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Came in by', key: 'channel', width: 12 },
    { header: 'Requester', key: 'requester', width: 24 },
    { header: 'Requester email', key: 'requesterEmail', width: 30 },
    { header: 'Email domain', key: 'domain', width: 22 },
    { header: 'Zendesk organisation', key: 'organisation', width: 20 },
    { header: 'Suggested DevOps project', key: 'suggested', width: 30 },
    { header: 'Assignee', key: 'assignee', width: 22 },
    { header: 'Group', key: 'group', width: 16 },
    { header: 'Tags', key: 'tags', width: 30 },
    { header: 'Created', key: 'created', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm' } },
    { header: 'Last updated', key: 'updated', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm' } },
    { header: 'Public replies', key: 'replies', width: 9 },
    { header: 'Internal notes', key: 'notes', width: 9 },
    { header: 'Attachments', key: 'attachments', width: 9 },
    { header: 'Custom fields', key: 'customFields', width: 30 },
    { header: 'First message', key: 'description', width: 80 },
  ],
  ticketRows
);

sheet(
  'Comments',
  [
    { header: 'Zendesk #', key: 'ticket', width: 10 },
    { header: 'When', key: 'when', width: 18, style: { numFmt: 'dd mmm yyyy hh:mm' } },
    { header: 'Author', key: 'author', width: 24 },
    { header: 'Author email', key: 'email', width: 30 },
    { header: 'Visibility', key: 'visibility', width: 14 },
    { header: 'Attachments', key: 'attachments', width: 9 },
    { header: 'Text', key: 'text', width: 100 },
  ],
  live.flatMap((t) =>
    (commentsByTicket.get(t.id) ?? []).map((c) => ({
      ticket: t.id,
      when: date(c.created_at),
      author: userName(c.author_id),
      email: userEmail(c.author_id),
      visibility: c.public ? 'Public reply' : 'Internal note',
      attachments: c.attachments?.length ?? 0,
      text: (c.plain_body ?? c.body ?? '').slice(0, 32000),
    }))
  )
);

sheet(
  'Attachments',
  [
    { header: 'Zendesk #', key: 'ticket', width: 10 },
    { header: 'File name', key: 'name', width: 40 },
    { header: 'Type', key: 'type', width: 24 },
    { header: 'Size (KB)', key: 'kb', width: 10 },
    { header: 'Downloaded', key: 'saved', width: 12 },
    { header: 'Saved as', key: 'file', width: 60 },
  ],
  attachments.map((a) => ({ ...a, kb: Math.round((a.size ?? 0) / 1024) }))
);

const people = [...users.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
sheet(
  'People',
  [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Role', key: 'role', width: 10 },
    { header: 'Organisation', key: 'org', width: 22 },
    { header: 'Tickets requested', key: 'requested', width: 10 },
    { header: 'Tickets assigned', key: 'assigned', width: 10 },
  ],
  people.map((u) => ({
    name: u.name,
    email: u.email ?? '',
    role: u.role,
    org: u.organization_id ? (orgs.get(u.organization_id)?.name ?? '') : '',
    requested: live.filter((t) => t.requester_id === u.id).length,
    assigned: live.filter((t) => t.assignee_id === u.id).length,
  }))
);

// Summary first in the workbook.
sum.columns = [
  { key: 'a', width: 46 },
  { key: 'b', width: 14 },
  { key: 'c', width: 34 },
];
const count = (f) => live.filter(f).length;
const add = (a, b = '', c = '', bold = false) => {
  const row = sum.addRow({ a, b, c });
  if (bold) row.font = { bold: true };
};
add('Zendesk export', '', '', true);
add('Exported on', new Date().toISOString().slice(0, 10));
add('Tickets (not deleted)', live.length);
add('Deleted tickets (left out)', tickets.length - live.length);
add('Oldest ticket', ticketRows[0]?.created?.toISOString().slice(0, 10) ?? '');
add(
  'Comments (replies and notes)',
  [...commentsByTicket.values()].reduce((s, c) => s + c.length, 0)
);
add('Attachments', attachments.length);
add('');
add('By status', '', '', true);
for (const s of ['new', 'open', 'pending', 'hold', 'solved', 'closed']) {
  add(
    `  ${s}`,
    count((t) => t.status === s)
  );
}
add('');
add('By email domain', 'Tickets', 'Suggested DevOps project', true);
const byDomain = new Map();
for (const r of ticketRows)
  byDomain.set(r.domain || '(no email)', (byDomain.get(r.domain || '(no email)') ?? 0) + 1);
for (const [d, c] of [...byDomain].sort((a, b) => b[1] - a[1]))
  add(`  ${d}`, c, SUGGESTED[d] ?? '?');

for (const name of ['Tickets', 'Comments']) {
  wb.getWorksheet(name).eachRow((row, i) => {
    if (i > 1) row.alignment = { vertical: 'top' };
  });
}

const xlsx = path.join(outDir, 'zendesk-export.xlsx');
await wb.xlsx.writeFile(xlsx);
console.log(`workbook: ${xlsx}`);
