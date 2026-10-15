/**
 * The ZapDesk GitHub App (#457).
 *
 * One GitHub App, registered once, serves every organisation that uses this
 * ZapDesk. A DevOps project admin clicks "Connect GitHub", installs the App on
 * their GitHub organisation, and picks repositories; their issues then show
 * beside that project's work items. Which installation belongs to which
 * project is kept on the DevOps project itself, as a project property, so
 * ZapDesk keeps no database and only someone who may edit the project can
 * change it.
 *
 * Server-only: it holds the App's private key and client secret.
 */

import { createHmac, createSign, timingSafeEqual } from 'crypto';
import type { DevOpsProject } from '@/types';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 15_000;
const DEVOPS_TIMEOUT_MS = 15_000;

/** Project property holding the project's GitHub installation. */
export const INSTALLATION_PROPERTY = 'ZapDesk.GitHubInstallation';
/** How long a "Connect GitHub" link stays valid. */
const CONNECT_STATE_TTL_MS = 30 * 60 * 1000;
/** Installation tokens last an hour; one is replaced this long before it ends. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** How long an installation's repository list, and a project's link, are reused. */
const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;
const PROPERTY_CACHE_TTL_MS = 2 * 60 * 1000;
/** Ceiling on pages of an installation's repositories (100 each). */
const MAX_REPO_PAGES = 10;

/** Azure DevOps "Project" security namespace, and its "Edit project-level information" bit. */
const PROJECT_NAMESPACE_ID = '52d39943-cb85-4d7f-8fa8-c6baac873819';
const PROJECT_GENERIC_WRITE = 2;

export interface GitHubAppConfig {
  appId: string;
  /** PEM private key of the App. */
  privateKey: string;
  /** The App's URL name: github.com/apps/<slug>. */
  slug: string;
  /** OAuth client of the App, used to check who installed it. */
  clientId: string;
  clientSecret: string;
  /** Secret GitHub signs webhook deliveries with; webhooks are refused without it. */
  webhookSecret?: string;
}

/** The App's settings, or null when the App is not set up on this server. */
export function gitHubAppConfig(): GitHubAppConfig | null {
  const appId = (process.env.GITHUB_APP_ID || '').trim();
  // App Service settings cannot hold line breaks, so they may be written as \n
  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const slug = (process.env.GITHUB_APP_SLUG || '').trim();
  const clientId = (process.env.GITHUB_APP_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GITHUB_APP_CLIENT_SECRET || '').trim();
  if (!appId || !privateKey || !slug || !clientId || !clientSecret) return null;
  return {
    appId,
    privateKey,
    slug,
    clientId,
    clientSecret,
    webhookSecret: (process.env.GITHUB_APP_WEBHOOK_SECRET || '').trim() || undefined,
  };
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** A short-lived JWT that authenticates as the App itself. */
export function appJwt(config: GitHubAppConfig, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // Back-dated a minute for clock drift; GitHub allows at most ten minutes
  const payload = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: config.appId })
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(config.privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function gitHub(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path.startsWith('http') ? path : `${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
}

export interface GitHubInstallation {
  id: number;
  account: string;
  /** 'all' or 'selected' repositories. */
  repositorySelection: string;
}

/** The installation as GitHub knows it, or null when it does not exist (any more). */
export async function getInstallation(
  config: GitHubAppConfig,
  installationId: number
): Promise<GitHubInstallation | null> {
  const response = await gitHub(`/app/installations/${installationId}`, appJwt(config));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for the installation`);
  const data = (await response.json()) as {
    id: number;
    account?: { login?: string };
    repository_selection?: string;
  };
  return {
    id: data.id,
    account: data.account?.login ?? '',
    repositorySelection: data.repository_selection ?? 'selected',
  };
}

const tokenCache = new Map<number, { token: string; expires: number }>();
const reposCache = new Map<number, { repos: string[]; expires: number }>();
const propertyCache = new Map<string, { value: ProjectInstallation | null; expires: number }>();

/** For tests: forget cached tokens, repository lists and project links. */
export function clearGitHubAppCaches(): void {
  tokenCache.clear();
  reposCache.clear();
  propertyCache.clear();
}

/** Forget an installation's token and repositories, after GitHub reports a change to it. */
export function forgetInstallation(installationId: number): void {
  tokenCache.delete(installationId);
  reposCache.delete(installationId);
}

/** An hour-long token for reading one installation's repositories. */
export async function installationToken(
  config: GitHubAppConfig,
  installationId: number
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && Date.now() < cached.expires) return cached.token;

  const response = await gitHub(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(config),
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for an installation token`);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  const expires = new Date(data.expires_at).getTime() - TOKEN_REFRESH_MARGIN_MS;
  tokenCache.set(installationId, { token: data.token, expires });
  return data.token;
}

/** `owner/repo` of every repository the installation may read. */
export async function installationRepos(
  config: GitHubAppConfig,
  installationId: number
): Promise<string[]> {
  const cached = reposCache.get(installationId);
  if (cached && Date.now() < cached.expires) return cached.repos;

  const token = await installationToken(config, installationId);
  const repos: string[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const response = await gitHub(`/installation/repositories?per_page=100&page=${page}`, token);
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} listing installation repositories`);
    }
    const data = (await response.json()) as { repositories?: Array<{ full_name: string }> };
    const batch = data.repositories ?? [];
    repos.push(...batch.map((repo) => repo.full_name));
    if (batch.length < 100) break;
    if (page === MAX_REPO_PAGES) {
      console.warn(
        `[GitHub App] Installation ${installationId} has more than ${MAX_REPO_PAGES * 100} repositories; the rest are not read.`
      );
    }
  }
  reposCache.set(installationId, { repos, expires: Date.now() + REPOS_CACHE_TTL_MS });
  return repos;
}

// ---------------------------------------------------------------- connect state

/** What a "Connect GitHub" link is for. Signed, so it cannot be changed or forged. */
export interface ConnectState {
  /** Azure DevOps organization. */
  org: string;
  projectId: string;
  /** Who started it: the session user id. */
  user: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function stateSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || '';
  if (!secret) throw new Error('NEXTAUTH_SECRET is needed to sign GitHub connect links');
  return secret;
}

function stateSignature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`github-connect:${payload}`).digest();
}

export function signConnectState(
  state: Omit<ConnectState, 'exp'>,
  now = Date.now(),
  secret = stateSecret()
): string {
  const payload = base64url(JSON.stringify({ ...state, exp: now + CONNECT_STATE_TTL_MS }));
  return `${payload}.${stateSignature(payload, secret).toString('base64url')}`;
}

/** The state, when it is ours, unchanged and not expired; otherwise null. */
export function verifyConnectState(
  value: string | null,
  now = Date.now(),
  secret = stateSecret()
): ConnectState | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = stateSignature(payload, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConnectState;
    if (typeof state.exp !== 'number' || now > state.exp) return null;
    if (!state.org || !state.projectId || !state.user) return null;
    return state;
  } catch {
    return null;
  }
}

/** Where to send an admin to install the App and pick repositories. */
export function installUrl(config: GitHubAppConfig, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * True when the GitHub user who just authorised the App can access the
 * installation.
 *
 * The installation id arrives in the browser's URL, so on its own it proves
 * nothing: anyone could paste another company's id. GitHub sends a one-time
 * code with it, which is exchanged here for the user's token; that token
 * lists only the installations the user can reach.
 */
export async function userCanAccessInstallation(
  config: GitHubAppConfig,
  code: string,
  installationId: number
): Promise<boolean> {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  const tokenData = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.warn('[GitHub App] Could not exchange the authorisation code:', tokenData.error);
    return false;
  }

  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const response = await gitHub(
      `/user/installations?per_page=100&page=${page}`,
      tokenData.access_token
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { installations?: Array<{ id: number }> };
    const batch = data.installations ?? [];
    if (batch.some((installation) => installation.id === installationId)) return true;
    if (batch.length < 100) return false;
  }
  return false;
}

// ---------------------------------------------------------------- DevOps project link

/** What is kept on the DevOps project. */
export interface ProjectInstallation {
  installationId: number;
  /** GitHub organisation or user the App is installed on, for display. */
  account: string;
}

function propertiesUrl(org: string, projectId: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(projectId)}/properties`;
}

function parseInstallation(value: unknown): ProjectInstallation | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const installationId = Number(parsed?.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) return null;
    return { installationId, account: String(parsed?.account ?? '') };
  } catch {
    return null;
  }
}

/** The GitHub installation connected to a DevOps project, read with the user's token. */
export async function readProjectInstallation(
  org: string,
  projectId: string,
  accessToken: string
): Promise<ProjectInstallation | null> {
  const key = `${org.toLowerCase()}/${projectId}`;
  const cached = propertyCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.value;

  const response = await fetch(
    `${propertiesUrl(org, projectId)}?keys=${encodeURIComponent(INSTALLATION_PROPERTY)}&api-version=7.1-preview.1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`Azure DevOps returned ${response.status} reading project properties`);
  }
  const data = (await response.json()) as { value?: Array<{ name: string; value: unknown }> };
  const property = data.value?.find((entry) => entry.name === INSTALLATION_PROPERTY);
  const value = property ? parseInstallation(property.value) : null;
  propertyCache.set(key, { value, expires: Date.now() + PROPERTY_CACHE_TTL_MS });
  return value;
}

/**
 * Connect (or, with null, disconnect) a project's GitHub installation, with the
 * user's own token. Azure DevOps refuses unless they may edit the project, so
 * that check is DevOps's, not ours.
 */
export async function writeProjectInstallation(
  org: string,
  projectId: string,
  accessToken: string,
  value: ProjectInstallation | null
): Promise<void> {
  const operation = value
    ? [{ op: 'add', path: `/${INSTALLATION_PROPERTY}`, value: JSON.stringify(value) }]
    : [{ op: 'remove', path: `/${INSTALLATION_PROPERTY}` }];
  const response = await fetch(`${propertiesUrl(org, projectId)}?api-version=7.1-preview.1`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(operation),
    signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
  });
  propertyCache.delete(`${org.toLowerCase()}/${projectId}`);
  // Removing a property that is not there is not an error worth showing
  if (!response.ok && !(value === null && response.status === 404)) {
    const error = new Error(`Azure DevOps returned ${response.status} saving project properties`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
}

/** True when the user may edit the project, and so connect GitHub to it. */
export async function canManageProject(
  org: string,
  projectId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/_apis/security/permissionevaluationbatch?api-version=7.1-preview.1`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alwaysAllowAdministrators: false,
          evaluations: [
            {
              securityNamespaceId: PROJECT_NAMESPACE_ID,
              token: `$PROJECT:vstfs:///Classification/TeamProject/${projectId}`,
              permissions: PROJECT_GENERIC_WRITE,
            },
          ],
        }),
        signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
      }
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { evaluations?: Array<{ value?: boolean }> };
    return data.evaluations?.[0]?.value === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- issues source

export interface AppRepoMapping {
  /** DevOps project name to the repositories its installation can read. */
  projectRepos: Record<string, string[]>;
  /** Installation token per repository, keyed in lower case. */
  tokens: Record<string, string>;
  /** Repositories (or installations) that could not be read. */
  failed: string[];
}

/**
 * The repositories connected to each of the given projects, with a token for
 * each. Only the projects passed in are looked at, so a caller passing the
 * projects a user can see never reaches an installation of one they cannot.
 */
export async function appProjectRepos(
  config: GitHubAppConfig,
  org: string,
  projects: DevOpsProject[],
  accessToken: string
): Promise<AppRepoMapping> {
  const mapping: AppRepoMapping = { projectRepos: {}, tokens: {}, failed: [] };

  const links = await Promise.allSettled(
    projects.map((project) => readProjectInstallation(org, project.id, accessToken))
  );

  await Promise.all(
    links.map(async (link, index) => {
      if (link.status !== 'fulfilled' || !link.value) return;
      const project = projects[index];
      try {
        const [repos, token] = await Promise.all([
          installationRepos(config, link.value.installationId),
          installationToken(config, link.value.installationId),
        ]);
        mapping.projectRepos[project.name] = repos;
        for (const repo of repos) mapping.tokens[repo.toLowerCase()] ??= token;
      } catch (error) {
        console.error(
          `[GitHub App] Could not read installation ${link.value.installationId} for ${project.name}:`,
          error
        );
        mapping.failed.push(link.value.account ? `${link.value.account}/*` : project.name);
      }
    })
  );

  return mapping;
}

/** True when a webhook delivery carries GitHub's signature for our secret. */
export function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
