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
//     [--only tickets,reporting] [--range 30] [--source github] \
//     [--base-url http://localhost:3102] [--out screenshots]
//
// Every option can also come from an environment variable:
//   ZAPDESK_ORG, ZAPDESK_ONLY, ZAPDESK_RANGE, ZAPDESK_SOURCE, ZAPDESK_BASE_URL,
//   ZAPDESK_OUT, CDP_URL
//
// The repository is public, so capture from the KnowAllTest demo organization
// (ABC Inc, Contoso Ltd, DEF Inc...). Never capture a real client's project.
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
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
    'base-url': { type: 'string' },
    'cdp-url': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(
    'Usage: node scripts/capture-screenshots.mjs --org <organization> [--only <name,name>] ' +
      '[--range <7|30|90|365>] [--source <both|devops|github>] [--base-url <url>] ' +
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

  await page.setViewportSize(VIEWPORT);
  console.log(`✓ Viewport set to ${VIEWPORT.width}x${VIEWPORT.height}`);

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

      // Let charts and transitions finish
      await page.waitForTimeout(1000);

      // Bring the tab to the front so the browser paints it (see above)
      await page.bringToFront();
      const filename = `${outputDir}/${shot.name}.png`;
      // scale: 'css' keeps the file at 1280x720 on HiDPI screens
      await page.screenshot({ path: filename, scale: 'css' });
      console.log(`✓ Saved ${filename}`);
    } catch (err) {
      console.error(`✗ ${shot.name}: ${err.message.split('\n')[0]}`);
      failed.push(shot.name);
    }
  }

  await page.close();
  // Leave the browser open; we only attached to it
  console.log(`\nScreenshots saved to ${outputDir}/`);
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}. Retry with --only ${failed.join(',')}`);
    process.exit(1);
  }
}

captureScreenshots();
