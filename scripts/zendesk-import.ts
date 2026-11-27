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
 * A ticket already tagged zendesk:<id> is skipped once its comments and files
 * are all there, so a rerun never duplicates. A tagged one that is missing some
 * stops the run instead, rather than be skipped or written twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_WORK_ITEM_TYPE,
  assertSafeWrite,
  commentHeader,
  commentHtml,
  descriptionHeader,
  attachmentKey,
  findImageSources,
  findZendeskImages,
  imageDownloadUrl,
  isConfiguredHost,
  parseImportArgs,
  planTicket,
  redirectTarget,
  replaceImageSrc,
  sortAttachments,
  sourceTag,
  withMissingTags,
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
  /** Where Zendesk served it: matches an inline picture to the img that shows it. */
  url?: string;
  /** A picture pasted into the comment; those are relinked in place, not attached. */
  inline?: boolean;
}

let args: ReturnType<typeof parseImportArgs>;
try {
  args = parseImportArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}
Usage: bun scripts/zendesk-import.ts --config <file> [--commit] <zendesk ids...|all>`);
  process.exit(1);
}
const { commit } = args;
const config = JSON.parse(fs.readFileSync(args.configFile, 'utf8')) as ScriptConfig;
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

/** Long enough for a 10 MB attachment, short enough that a stalled request ends the run. */
const REQUEST_DEADLINE_MS = 120_000;

/**
 * fetch with a deadline covering the whole exchange, body included: the signal
 * stays live while `read` consumes the response (#704 review).
 */
async function timedFetch<T>(
  what: string,
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
  try {
    return await read(await fetch(url, { ...init, signal: controller.signal }));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${what}: no answer within ${REQUEST_DEADLINE_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function devops<T>(
  method: string,
  url: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<{ json: T; headers: Headers }> {
  const what = `${method} ${new URL(url).pathname}`;
  return timedFetch(
    what,
    url,
    {
      method,
      headers: { Authorization: AUTH, 'Content-Type': contentType },
      body:
        body === undefined
          ? undefined
          : body instanceof Uint8Array
            ? (body as BodyInit)
            : JSON.stringify(body),
    },
    async (res) => {
      const json = (await res.json().catch(() => ({}))) as T & { message?: string };
      if (!res.ok) throw new Error(`${what} -> ${res.status}: ${json.message ?? ''}`);
      return { json, headers: res.headers };
    }
  );
}

/** Every work item write goes through here, and so through assertSafeWrite. */
async function write<T>(method: 'POST' | 'PATCH', url: string, ops: JsonPatchOp[]): Promise<T> {
  assertSafeWrite(method, url, ops, type);
  if (!commit && !url.includes('validateOnly=true')) {
    throw new Error('Dry run: refusing a real write');
  }
  return (await devops<T>(method, url, ops, 'application/json-patch+json')).json;
}

/** Every project in the organisation, id -> name, across all pages. */
async function allProjects(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let continuation: string | null = null;
  do {
    const page: string = `${ORG}/_apis/projects?$top=500&api-version=7.1${
      continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ''
    }`;
    const result: { json: { value: { id: string; name: string }[] }; headers: Headers } =
      await devops('GET', page);
    for (const p of result.json.value) names.set(p.id, p.name);
    continuation = result.headers.get('x-ms-continuationtoken');
  } while (continuation);
  return names;
}

/**
 * Stops the run if a service hook would fire for what the import creates, or
 * if a hook's project can't be identified: unknown is treated as unsafe.
 */
async function assertNoHooks(projects: string[]): Promise<void> {
  const names = await allProjects();
  const missing = projects.filter((p) => ![...names.values()].includes(p));
  if (missing.length) throw new Error(`Unknown DevOps project(s): ${missing.join(', ')}`);

  const { json } = await devops<{
    value: { eventType: string; publisherInputs?: Record<string, string> }[];
  }>('GET', `${ORG}/_apis/hooks/subscriptions?api-version=7.1`);
  const hooks = json.value;
  const unsafe = hooks.filter((h) => {
    if (!h.eventType.startsWith('workitem.')) return false;
    const filter = h.publisherInputs?.workItemType;
    if (filter && filter !== type) return false;
    const project = h.publisherInputs?.projectId;
    if (!project) return true; // organisation-wide
    const name = names.get(project);
    return name === undefined || projects.includes(name);
  });
  if (unsafe.length) {
    throw new Error(
      `${unsafe.length} service hook(s) could fire for a ${type} in the target projects; not importing`
    );
  }
  console.log(`service hooks: none fire for a ${type} (${hooks.length} checked)`);
}

let zendeskToken: string | null = null;
async function signedIn(): Promise<string> {
  if (zendeskToken) return zendeskToken;
  const secret = fs.readFileSync(config.zendeskSecretFile, 'utf8').trim();
  const body = await timedFetch(
    'Zendesk sign-in',
    `https://${config.zendeskSubdomain}.zendesk.com/oauth/tokens`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.zendeskClientId,
        client_secret: secret,
        scope: 'read',
        expires_in: 3600,
      }),
    },
    async (res) => {
      const json = (await res.json().catch(() => ({}))) as { access_token?: string };
      if (!res.ok || !json.access_token)
        throw new Error(`Zendesk sign-in failed: HTTP ${res.status}`);
      return json;
    }
  );
  return (zendeskToken = body.access_token as string);
}

/**
 * An inline picture, tried signed out and then with the token. Zendesk answers
 * a signed-out request with its sign-in page, so only an image/* body counts.
 * imageDownloadUrl refuses anything but HTTPS to a configured host first.
 */
type Picture = { bytes: Uint8Array; type: string };
type Step = Picture | { next: string } | null;

async function download(src: string): Promise<Picture> {
  const first = imageDownloadUrl(src, config.zendeskImageHosts);
  for (const signIn of [false, true]) {
    const token = signIn ? await signedIn() : null;
    // Redirects are followed by hand: every hop must be HTTPS, and the token is
    // only sent to a configured host. Zendesk redirects to a pre-signed link on
    // its file host, which needs no token.
    let url = first;
    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> =
        token && isConfiguredHost(url, config.zendeskImageHosts)
          ? { Authorization: `Bearer ${token}` }
          : {};
      const step: Step = await timedFetch(
        `picture from ${new URL(url).host}`,
        url,
        { headers, redirect: 'manual' },
        async (res): Promise<Step> => {
          const location = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && location) {
            return { next: redirectTarget(location, url) };
          }
          const contentType = res.headers.get('content-type') ?? '';
          if (!res.ok || !contentType.startsWith('image/')) return null;
          return { bytes: new Uint8Array(await res.arrayBuffer()), type: contentType };
        }
      );
      if (step && 'next' in step) {
        url = step.next;
        continue;
      }
      if (step) return step;
      break;
    }
  }
  throw new Error(`inline picture could not be downloaded (${new URL(first).host})`);
}

async function upload(project: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const url = `${ORG}/${encodeURIComponent(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`;
  return (await devops<{ url: string }>('POST', url, bytes, 'application/octet-stream')).json.url;
}

async function alreadyImported(project: string, zendeskId: number): Promise<number[]> {
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${sourceTag(zendeskId)}'`;
  const url = `${ORG}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`;
  const { json } = await devops<{ workItems: { id: number }[] }>('POST', url, { query });
  return json.workItems.map((w) => w.id);
}

/** How many comments and attached files an existing work item has. */
async function contents(
  project: string,
  id: number
): Promise<{ comments: number; files: number; tags: string }> {
  const { json: item } = await devops<{
    relations?: { rel: string }[];
    fields?: Record<string, unknown>;
  }>('GET', `${ORG}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`);
  const { json: page } = await devops<{ totalCount: number }>(
    'GET',
    `${ORG}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?$top=1&api-version=7.1-preview.4`
  );
  return {
    comments: page.totalCount,
    files: (item.relations ?? []).filter((r) => r.rel === 'AttachedFile').length,
    tags: String(item.fields?.['System.Tags'] ?? ''),
  };
}

const selected =
  args.ids === 'all'
    ? tickets
    : args.ids.map((id) => {
        const ticket = tickets.find((t) => t.id === id);
        if (!ticket) throw new Error(`Zendesk #${id} is not in the export`);
        return ticket;
      });
const plans = selected.map((ticket) => ({ ticket, plan: planTicket(ticket, users, config) }));
const ready = plans.filter((p) => p.plan.problems.length === 0);
for (const { plan } of plans.filter((p) => p.plan.problems.length > 0)) {
  console.log(`#${plan.zendeskId}: skipped, ${plan.problems.join('; ')}`);
}
console.log(`${commit ? 'IMPORT' : 'DRY RUN'}: ${ready.length} ticket(s)`);
await assertNoHooks([...new Set(ready.map((p) => p.plan.project as string))]);

for (const { ticket, plan } of ready) {
  const project = plan.project as string;
  const comments = commentsOf(ticket.id);
  const saved = attachments.filter((a) => a.ticket === ticket.id);

  // Every inline picture the export saved must end up in DevOps: relinked where
  // a comment shows it, attached as a file where none does (#704 review).
  if (saved.some((a) => a.inline && !a.url)) {
    throw new Error(`#${ticket.id}: the export predates source URLs; export again`);
  }
  const { byKey: inlineByKey, files } = sortAttachments(saved, comments.map(commentHtml));

  const found = await alreadyImported(project, ticket.id);
  if (found.length > 1) {
    throw new Error(`#${ticket.id}: imported more than once (${found.join(', ')}); fix by hand`);
  }
  if (found.length === 1) {
    const has = await contents(project, found[0]);
    const want = { comments: comments.length - 1, files: files.length };
    if (has.comments === want.comments && has.files === want.files) {
      // Imported before a tag was added to importTags (`ticket`, #709): add
      // it, or ZapDesk keeps the Task out of its lists. Same safe write as
      // any other: suppressNotifications, and never an email tag.
      const tags = withMissingTags(has.tags, plan.tags);
      if (tags) {
        const retag = `${ORG}/_apis/wit/workitems/${found[0]}?bypassRules=true&suppressNotifications=true${commit ? '' : '&validateOnly=true'}&api-version=7.1`;
        await write('PATCH', retag, [{ op: 'add', path: '/fields/System.Tags', value: tags }]);
        console.log(
          `#${ticket.id}: already imported as ${found[0]}, complete; ${commit ? 'tags updated' : 'would update tags'} to ${tags}`
        );
        continue;
      }
      console.log(`#${ticket.id}: already imported as ${found[0]}, complete, skipped`);
      continue;
    }
    throw new Error(
      `#${ticket.id}: ${found[0]} is incomplete (${has.comments}/${want.comments} comments, ` +
        `${has.files}/${want.files} files). Delete it in DevOps and run again.`
    );
  }

  const missing = saved.filter(
    (a) => a.saved !== 'yes' || !fs.existsSync(path.join(config.exportDir, a.file))
  );
  if (missing.length) {
    throw new Error(`#${ticket.id}: ${missing.length} attachment(s) missing from the export`);
  }

  // Inline pictures: the export's copy where there is one, whatever host the
  // HTML names; otherwise downloaded from a configured Zendesk host. Uploaded
  // and relinked only on --commit.
  let pictures = 0;
  const bodies: string[] = [];
  for (const comment of comments) {
    let html = commentHtml(comment);
    const zendesk = new Set(findZendeskImages(html, config.zendeskImageHosts));
    for (const src of findImageSources(html)) {
      const key = attachmentKey(src);
      const copy = key === null ? undefined : inlineByKey.get(key);
      if (!copy && !zendesk.has(src)) continue; // someone else's picture, left as it is
      const picture = copy
        ? { bytes: fs.readFileSync(path.join(config.exportDir, copy.file)), type: copy.type }
        : await download(src);
      pictures++;
      if (commit) {
        const ext = picture.type.split('/')[1].split(/[;+]/)[0].replace('jpeg', 'jpg');
        const name = `zendesk-${ticket.id}-image-${pictures}.${ext}`;
        html = replaceImageSrc(html, src, await upload(project, name, picture.bytes));
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
  const created = await write<{ id?: number }>(
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
