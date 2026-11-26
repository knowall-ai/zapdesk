/**
 * Import tickets from a Zendesk export (scripts/zendesk-export.mjs) into Azure
 * DevOps, one Task per ticket. Dry run unless --commit is given.
 *
 *   bun scripts/zendesk-import.ts --config <file> [--commit] <zendesk ids...|all>
 *
 * The config file holds the real organisation, mapping and secret paths, so it
 * lives outside this repository. See scripts/zendesk-import.config.example.json.
 *
 * Dry run: DevOps is only asked to validate each ticket (validateOnly=true) and
 * Zendesk is only read. Nothing is created or changed anywhere.
 *
 * --commit: creates the Tasks. No email can go out, and the checks for that are
 * in code, not in the operator's memory: see src/lib/zendesk-import.ts. Before
 * any write the run also stops if a DevOps service hook would fire for the
 * created work item type in a target project.
 *
 * A ticket already tagged zendesk:<id> is skipped, so a rerun never duplicates.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_WORK_ITEM_TYPE,
  assertSafeWrite,
  commentHeader,
  commentHtml,
  descriptionHeader,
  findZendeskImages,
  planTicket,
  replaceImageSrc,
  sourceTag,
  type ImportConfig,
  type JsonPatchOp,
  type ZendeskComment,
  type ZendeskTicket,
  type ZendeskUser,
} from '../src/lib/zendesk-import';

interface ScriptConfig extends ImportConfig {
  /** The folder scripts/zendesk-export.mjs wrote (raw/, attachments/). */
  exportDir: string;
  /** A file holding an Azure DevOps PAT with Work Items read & write. */
  devopsPatFile: string;
  /** For inline pictures, which need a signed-in download. */
  zendeskSubdomain: string;
  zendeskClientId: string;
  zendeskSecretFile: string;
}

interface SavedAttachment {
  ticket: number;
  type: string;
  size: number;
  saved: string;
  file: string;
}

const args = process.argv.slice(2);
const configAt = args.indexOf('--config');
const commit = args.includes('--commit');
const ids = args.filter((a, i) => !a.startsWith('--') && i !== configAt + 1);
if (configAt < 0 || !args[configAt + 1] || ids.length === 0) {
  console.error(
    'Usage: bun scripts/zendesk-import.ts --config <file> [--commit] <zendesk ids...|all>'
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(args[configAt + 1], 'utf8')) as ScriptConfig;
const type = config.workItemType ?? DEFAULT_WORK_ITEM_TYPE;
const ORG = `https://dev.azure.com/${encodeURIComponent(config.devopsOrg)}`;
const AUTH =
  'Basic ' +
  Buffer.from(':' + fs.readFileSync(config.devopsPatFile, 'utf8').trim()).toString('base64');

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(config.exportDir, file), 'utf8')) as T;
const tickets = readJson<ZendeskTicket[]>('raw/tickets.json');
const users = new Map(readJson<ZendeskUser[]>('raw/users.json').map((u) => [u.id, u]));
const attachments = readJson<SavedAttachment[]>('raw/attachments.json');
const commentsOf = (id: number) => readJson<ZendeskComment[]>(`raw/comments/${id}.json`);

async function devops<T>(
  method: string,
  url: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': contentType },
    body:
      body === undefined
        ? undefined
        : body instanceof Uint8Array
          ? (body as BodyInit)
          : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok)
    throw new Error(`${method} ${new URL(url).pathname} -> ${res.status}: ${json.message ?? ''}`);
  return json;
}

/** Every work item write goes through here, and so through assertSafeWrite. */
function write<T>(method: 'POST' | 'PATCH', url: string, ops: JsonPatchOp[]): Promise<T> {
  assertSafeWrite(method, url, ops, type);
  if (!commit && !url.includes('validateOnly=true'))
    throw new Error('Dry run: refusing a real write');
  return devops<T>(method, url, ops, 'application/json-patch+json');
}

/** Stops the run if a service hook would fire for what the import creates. */
async function assertNoHooks(projects: string[]): Promise<void> {
  const names = new Map(
    (
      await devops<{ value: { id: string; name: string }[] }>(
        'GET',
        `${ORG}/_apis/projects?$top=500&api-version=7.1`
      )
    ).value.map((p) => [p.id, p.name])
  );
  const hooks = (
    await devops<{ value: { eventType: string; publisherInputs?: Record<string, string> }[] }>(
      'GET',
      `${ORG}/_apis/hooks/subscriptions?api-version=7.1`
    )
  ).value;
  const firing = hooks.filter((h) => {
    if (!h.eventType.startsWith('workitem.')) return false;
    const project = h.publisherInputs?.projectId;
    const filter = h.publisherInputs?.workItemType;
    return (
      (!project || projects.includes(names.get(project) ?? '')) && (!filter || filter === type)
    );
  });
  if (firing.length) {
    throw new Error(
      `${firing.length} service hook(s) would fire for a ${type} in the target projects; not importing`
    );
  }
  console.log(`service hooks: none fire for a ${type} (${hooks.length} checked)`);
}

let zendeskToken: string | null = null;
async function signedIn(): Promise<string> {
  if (zendeskToken) return zendeskToken;
  const res = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/oauth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.zendeskClientId,
      client_secret: fs.readFileSync(config.zendeskSecretFile, 'utf8').trim(),
      scope: 'read',
      expires_in: 3600,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`Zendesk sign-in failed: HTTP ${res.status}`);
  return (zendeskToken = body.access_token);
}

/** An inline picture. Zendesk answers a signed-out request with its sign-in page, so only image/* counts. */
async function download(src: string): Promise<{ bytes: Uint8Array; type: string }> {
  const url = src.replace(/&amp;/g, '&');
  for (const auth of [false, true]) {
    const headers: Record<string, string> = auth
      ? { Authorization: `Bearer ${await signedIn()}` }
      : {};
    const res = await fetch(url, { headers }).catch(() => null);
    const contentType = res?.headers.get('content-type') ?? '';
    if (res?.ok && contentType.startsWith('image/')) {
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: contentType };
    }
  }
  throw new Error(`inline picture could not be downloaded (${new URL(url).host})`);
}

async function upload(project: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const url = `${ORG}/${encodeURIComponent(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`;
  return (await devops<{ url: string }>('POST', url, bytes, 'application/octet-stream')).url;
}

async function alreadyImported(project: string, zendeskId: number): Promise<number[]> {
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${sourceTag(zendeskId)}'`;
  const url = `${ORG}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`;
  return (await devops<{ workItems: { id: number }[] }>('POST', url, { query })).workItems.map(
    (w) => w.id
  );
}

const selected =
  ids[0] === 'all' ? tickets : ids.map(Number).map((id) => tickets.find((t) => t.id === id));
const plans = selected.map((t, i) => {
  if (!t) throw new Error(`Zendesk #${ids[i]} is not in the export`);
  return { ticket: t, plan: planTicket(t, users, config) };
});
const ready = plans.filter((p) => p.plan.problems.length === 0);
for (const { plan } of plans.filter((p) => p.plan.problems.length > 0)) {
  console.log(`#${plan.zendeskId}: skipped, ${plan.problems.join('; ')}`);
}
console.log(`${commit ? 'IMPORT' : 'DRY RUN'}: ${ready.length} ticket(s)`);
await assertNoHooks([...new Set(ready.map((p) => p.plan.project as string))]);

for (const { ticket, plan } of ready) {
  const project = plan.project as string;
  const found = await alreadyImported(project, ticket.id);
  if (found.length) {
    console.log(`#${ticket.id}: already imported as ${found.join(', ')}, skipped`);
    continue;
  }
  const comments = commentsOf(ticket.id);
  const files = attachments.filter((a) => a.ticket === ticket.id);
  const missing = files.filter((a) => !fs.existsSync(path.join(config.exportDir, a.file)));
  if (missing.length)
    throw new Error(`#${ticket.id}: ${missing.length} attachment(s) missing from the export`);

  // Inline pictures: downloaded either way, uploaded and relinked only on --commit.
  let pictures = 0;
  const bodies: string[] = [];
  for (const comment of comments) {
    let html = commentHtml(comment);
    for (const src of findZendeskImages(html, config.zendeskImageHosts)) {
      const picture = await download(src);
      pictures++;
      if (commit) {
        const ext = picture.type.split('/')[1].split(/[;+]/)[0].replace('jpeg', 'jpg');
        html = replaceImageSrc(
          html,
          src,
          await upload(project, `zendesk-${ticket.id}-image-${pictures}.${ext}`, picture.bytes)
        );
      }
    }
    bodies.push(html);
  }

  const requester = ticket.requester_id ? users.get(ticket.requester_id) : undefined;
  const fields: [string, unknown][] = [
    ['System.Title', ticket.subject || `Zendesk #${ticket.id}`],
    ['System.Description', descriptionHeader(ticket, requester) + (bodies[0] ?? '')],
    ['System.AssignedTo', plan.assignee],
    ['Microsoft.VSTS.Common.Priority', plan.priority],
    ['System.Tags', plan.tags.join('; ')],
    ['System.CreatedDate', ticket.created_at],
    ['System.State', plan.state],
  ];
  const ops = fields.map(([field, value]) => ({ op: 'add', path: `/fields/${field}`, value }));
  // bypassRules: a Task can't otherwise be created already Closed or Pending, or with its old date.
  const query = `bypassRules=true&suppressNotifications=true${commit ? '' : '&validateOnly=true'}&api-version=7.1`;
  const created = await write<{
    id?: number;
    fields: Record<string, { displayName?: string } | string>;
  }>(
    'POST',
    `${ORG}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?${query}`,
    ops
  );
  const summary = `${comments.length - 1} comments, ${files.length} files, ${pictures} pictures`;
  if (!commit) {
    console.log(`#${ticket.id} -> ${project}: valid (${plan.state}); ${summary}`);
    continue;
  }

  const id = created.id as number;
  const update = `${ORG}/_apis/wit/workitems/${id}?bypassRules=true&suppressNotifications=true&api-version=7.1`;
  for (let i = 1; i < comments.length; i++) {
    const history = commentHeader(comments[i], users.get(comments[i].author_id)) + bodies[i];
    await write('PATCH', update, [{ op: 'add', path: '/fields/System.History', value: history }]);
  }
  if (files.length) {
    const relations: JsonPatchOp[] = [];
    for (const a of files) {
      const name = path.basename(a.file).replace(/^\d+-/, '');
      const url = await upload(project, name, fs.readFileSync(path.join(config.exportDir, a.file)));
      relations.push({
        op: 'add',
        path: '/relations/-',
        value: { rel: 'AttachedFile', url, attributes: { comment: 'From Zendesk' } },
      });
    }
    await write('PATCH', update, relations);
  }
  console.log(`#${ticket.id} -> ${project} #${id} (${plan.state}); ${summary}`);
}
