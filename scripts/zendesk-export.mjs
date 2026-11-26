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
async function newToken() {
  const r = await fetch(`${base}/oauth/tokens`, {
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
  token = body.access_token;
}

/** GET with a bearer token; renews an expired token and waits out rate limits. */
async function get(url, { raw = false } = {}) {
  const full = url.startsWith('http') ? url : `${base}${url}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(full, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401 && attempt === 0) {
      await newToken();
      continue;
    }
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after') ?? 10);
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`GET ${full} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    return raw ? r : r.json();
  }
  throw new Error(`GET ${full} kept failing`);
}

async function getAll(url, key) {
  const items = [];
  let next = url;
  while (next) {
    const page = await get(next);
    items.push(...(page[key] ?? []));
    next = page.next_page ?? null;
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

const ticketFields = await getAll('/api/v2/ticket_fields.json', 'ticket_fields');
for (const o of await getAll('/api/v2/organizations.json?per_page=100', 'organizations')) {
  orgs.set(o.id, o);
}
for (const g of await getAll('/api/v2/groups.json?per_page=100', 'groups')) groups.set(g.id, g);

const live = tickets.filter((t) => t.status !== 'deleted').sort((a, b) => a.id - b.id);

// Comments, with their authors, and attachments.
const commentsByTicket = new Map();
const attachments = [];
let n = 0;
for (const t of live) {
  const comments = [];
  let next = `/api/v2/tickets/${t.id}/comments.json?include=users&per_page=100`;
  while (next) {
    const page = await get(next);
    comments.push(...page.comments);
    for (const u of page.users ?? []) users.set(u.id, u);
    next = page.next_page ?? null;
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
        try {
          const r = await get(a.content_url, { raw: true });
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          saved = `failed: ${String(e.message).slice(0, 80)}`;
        }
      }
      attachments.push({
        ticket: t.id,
        comment: c.id,
        name: a.file_name,
        type: a.content_type,
        size: a.size,
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
