// Capture page screenshots from a running ZapDesk dev server.
//
// ZapDesk signs in with Microsoft (NextAuth + Azure AD), so there is no token a
// script could mint. Instead this attaches to a browser you have already signed
// in to, started with --remote-debugging-port=9222, opens each page in a fresh
// tab of that signed-in session and saves 1280x720 PNGs. See
// .claude/skills/capture-app-screenshots.md for the full guide.
//
// Usage:
//   node scripts/capture-screenshots.mjs --org KnowAllTest \
//     [--only tickets,reporting] [--range 30] [--source github] [--zoom 0.67] \
//     [--base-url http://localhost:3102] [--out screenshots]
//
// Every option can also come from an environment variable:
//   ZAPDESK_ORG, ZAPDESK_ONLY, ZAPDESK_RANGE, ZAPDESK_SOURCE, ZAPDESK_ZOOM,
//   ZAPDESK_BASE_URL, ZAPDESK_OUT, CDP_URL
//
// The repository is public, so capture from the KnowAllTest demo organization
// (ABC Inc, Contoso Ltd, DEF Inc...). Never capture a real client's project.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { parseArgs } from 'util';

const VIEWPORT = { width: 1280, height: 720 };
const RANGES = ['7', '30', '90', '365'];
const SOURCES = ['both', 'devops', 'github'];

const { values: args } = parseArgs({
  options: {
    org: { type: 'string' },
    only: { type: 'string' },
    range: { type: 'string' },
    source: { type: 'string' },
    zoom: { type: 'string' },
    'base-url': { type: 'string' },
    'cdp-url': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(
    'Usage: node scripts/capture-screenshots.mjs --org <organization> [--only <name,name>] ' +
      '[--range <7|30|90|365>] [--source <both|devops|github>] [--zoom <0.5-1>] [--base-url <url>] ' +
      '[--cdp-url <url>] [--out <dir>]'
  );
  process.exit(0);
}

const organization = args.org ?? process.env.ZAPDESK_ORG ?? '';
const only = (args.only ?? process.env.ZAPDESK_ONLY ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const range = args.range ?? process.env.ZAPDESK_RANGE ?? '30';
const source = (args.source ?? process.env.ZAPDESK_SOURCE ?? 'both').toLowerCase();
const zoom = Number(args.zoom ?? process.env.ZAPDESK_ZOOM ?? '1');
const baseUrl = (
  args['base-url'] ??
  process.env.ZAPDESK_BASE_URL ??
  'http://localhost:3102'
).replace(/\/$/, '');
const cdpUrl = args['cdp-url'] ?? process.env.CDP_URL ?? 'http://localhost:9222';
const outputDir = (args.out ?? process.env.ZAPDESK_OUT ?? 'screenshots').replace(/\/$/, '');

if (!organization) {
  console.error(
    '--org (or ZAPDESK_ORG) must name the Azure DevOps organization to capture, e.g. KnowAllTest.'
  );
  process.exit(1);
}
if (!RANGES.includes(range)) {
  console.error(`--range must be one of ${RANGES.join(', ')}, not "${range}"`);
  process.exit(1);
}
if (!(zoom >= 0.5 && zoom <= 1)) {
  console.error(`--zoom must be between 0.5 and 1, not "${args.zoom ?? process.env.ZAPDESK_ZOOM}"`);
  process.exit(1);
}
if (!SOURCES.includes(source)) {
  console.error(`--source must be one of ${SOURCES.join(', ')}, not "${source}"`);
  process.exit(1);
}

// Hide the Next.js dev badge (it lives in the nextjs-portal element)
const HIDE_CSS = 'nextjs-portal { display: none !important; }';

/** Wait until no loading spinner is on screen. */
async function spinnersGone(page) {
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout: 30000 })
    .catch(() => {});
}

/** Press the Live Dashboard's range button (7d, 30d, 90d, 365d). */
async function chooseRange(page, days) {
  const button = page.locator(`button[aria-pressed]:has-text("${days}d")`).first();
  if (await button.getAttribute('aria-pressed')) {
    await button.click();
    await spinnersGone(page);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
}

/**
 * The shots. `ready` is on screen once the page has loaded its data; `prepare`
 * sets up whatever the shot needs (range, expanded rows).
 */
const shots = [
  {
    name: 'tickets',
    path: '/tickets',
    ready: 'main',
  },
  {
    name: 'kanban',
    path: '/kanban',
    ready: 'h1:has-text("Kanban Board")',
  },
  {
    name: 'reporting',
    path: '/reporting',
    ready: 'h2:has-text("Ticket Volume")',
    prepare: (page) => chooseRange(page, range),
  },
  {
    name: 'team-pull-requests',
    path: '/team',
    ready: 'h2:has-text("Team Members")',
    prepare: async (page) => {
      // Bring the Pull Requests card to the top of the viewport
      const heading = page.locator('h2:has-text("Pull Requests")').first();
      if (!(await heading.count())) throw new Error('No Pull Requests card on this build');
      const button = page.locator(`button[role="radio"]:has-text("${range}d")`).first();
      if ((await button.count()) && (await button.getAttribute('aria-checked')) !== 'true') {
        await button.click();
      }
      await page
        .locator('text=Loading pull requests…')
        .waitFor({ state: 'hidden', timeout: 60000 })
        .catch(() => {});
      await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -24));
    },
  },
  {
    name: 'team',
    path: '/team',
    ready: 'h2:has-text("Team Members")',
  },
  {
    name: 'projects',
    path: '/projects',
    ready: 'h1:has-text("Projects")',
  },
  {
    name: 'users',
    path: '/users',
    ready: 'h1:has-text("Users")',
  },
];

/**
 * Refuse to capture unless the signed-in account can actually open the
 * organization that was asked for.
 *
 * `addInitScript` only *requests* one: it writes the name to localStorage, and
 * OrganizationProvider then checks it against the organizations the account
 * can reach and quietly falls back to the first of those when it cannot. So a
 * run by somebody without access to the demo organization does not fail -- it
 * photographs a real one instead, and these images go into a public
 * repository. Checked against the API the provider itself reads, so there is
 * no race with the fallback being written.
 */
async function confirmOrganization(page) {
  const waitForOrgs = page.waitForResponse(
    (response) => response.url().includes('/api/devops/organizations') && response.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(`${baseUrl}/tickets`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    throw new Error('Redirected to /login: sign in to ZapDesk in the debug browser first');
  }

  let available = [];
  try {
    const body = await (await waitForOrgs).json();
    available = (body.organizations ?? []).map((org) => org.accountName);
  } catch {
    throw new Error(
      'Could not read the organizations this account can open, so the one being ' +
        'captured cannot be confirmed. Refusing to capture.'
    );
  }

  if (!available.includes(organization)) {
    throw new Error(
      `This account cannot open the ${organization} organization` +
        `${available.length ? ` -- it has ${available.join(', ')}` : ''}. ` +
        'ZapDesk would quietly fall back to another one, and these screenshots ' +
        'are committed to a public repository. Refusing to capture.'
    );
  }

  console.log(`✓ Confirmed the ${organization} organization is the one being captured`);
}

async function captureScreenshots() {
  const selected = only.length ? shots.filter((shot) => only.includes(shot.name)) : shots;
  const unknown = only.filter((name) => !shots.some((shot) => shot.name === name));
  if (unknown.length) {
    console.error(
      `Unknown screenshot(s): ${unknown.join(', ')}. Choose from: ${shots.map((s) => s.name).join(', ')}`
    );
    process.exit(1);
  }

  let browser;
  try {
    console.log(`Connecting to browser at ${cdpUrl}...`);
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    console.error('Error:', err.message);
    console.log(
      '\nStart a browser with remote debugging, then sign in to ZapDesk in it:\n' +
        `  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/zapdesk-screenshots" ${baseUrl}`
    );
    process.exit(1);
  }
  console.log('✓ Connected to browser');

  // A fresh tab in the signed-in context. Reusing an open tab can hang: the browser stops
  // painting background tabs, so a screenshot of one waits forever.
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Pick the organization and work item source the way the header switchers do, so
  // every page shows the demo organization whatever was selected before.
  await page.addInitScript(
    ({ org, filter }) => {
      localStorage.setItem('zapdesk-selected-org', org);
      localStorage.setItem('zapdesk:source-filter', filter);
      localStorage.setItem('zapdesk:sidebar:collapsed', 'false');
    },
    { org: organization, filter: source }
  );

  page.on('dialog', async (dialog) => {
    console.log(`  Dialog detected: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });

  // Zooming out shows more of a page in the same 1280x720 image: lay the page
  // out on a larger viewport and capture it scaled back down.
  const viewport = {
    width: Math.round(VIEWPORT.width / zoom),
    height: Math.round(VIEWPORT.height / zoom),
  };
  await page.setViewportSize(viewport);
  const cdp = await context.newCDPSession(page);
  // Pin one device pixel per CSS pixel: the clip scale below is multiplied by
  // the screen's own density otherwise, and a HiDPI screen would give 2x files
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  console.log(
    `✓ Viewport set to ${VIEWPORT.width}x${VIEWPORT.height} at ${Math.round(zoom * 100)}% zoom`
  );

  await confirmOrganization(page);

  await mkdir(outputDir, { recursive: true });

  const failed = [];

  for (const shot of selected) {
    const url = `${baseUrl}${shot.path}`;
    console.log(`\nNavigating to ${shot.name}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (page.url().includes('/login')) {
        throw new Error('Redirected to /login: sign in to ZapDesk in the debug browser first');
      }
      await page.locator(shot.ready).first().waitFor({ state: 'visible', timeout: 30000 });
      await spinnersGone(page);
      // Let the remaining DevOps requests finish (pages poll, so don't insist on idle)
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      await page.addStyleTag({ content: HIDE_CSS });
      if (shot.prepare) await shot.prepare(page);

      // Let charts and transitions finish (recharts draws a line over 1.5s)
      await page.waitForTimeout(2000);

      // Bring the tab to the front so the browser paints it (see above)
      await page.bringToFront();
      const filename = `${outputDir}/${shot.name}.png`;
      // Capture through the protocol directly: its clip scale ignores the
      // screen's own pixel density, so the file is 1280x720 whatever the zoom
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: zoom },
      });
      await writeFile(filename, Buffer.from(data, 'base64'));
      console.log(`✓ Saved ${filename}`);
    } catch (err) {
      console.error(`✗ ${shot.name}: ${err.message.split('\n')[0]}`);
      failed.push(shot.name);
    }
  }

  await page.close();
  // Disconnect (the browser itself stays open; we only attached to it) so the
  // script can exit.
  await browser.close();
  console.log(`\nScreenshots saved to ${outputDir}/`);
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}. Retry with --only ${failed.join(',')}`);
    process.exit(1);
  }
}

captureScreenshots();
