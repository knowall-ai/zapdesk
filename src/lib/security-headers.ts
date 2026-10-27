/**
 * Security headers shared by `next.config.ts` (every response, static assets
 * included) and `src/proxy.ts` (the per-request, nonce-based CSP on pages).
 *
 * ZapDesk is not embedded anywhere (it is not a Teams tab), so framing is
 * denied outright with both `X-Frame-Options` and CSP `frame-ancestors`.
 *
 * If the zapdesk-msteams tab (`/teams/my-tickets`) goes live, those routes
 * must instead send `frame-ancestors` listing the Teams and Microsoft 365
 * hosts (teams.microsoft.com, *.teams.microsoft.com, *.office.com,
 * *.cloud.microsoft, *.skype.com) and no `X-Frame-Options`, since that header
 * cannot allow-list origins. Every other route keeps denying framing.
 */

export const BASELINE_SECURITY_HEADERS: { key: string; value: string }[] = [
  // Two years, covering this host and any subdomain of it. No `preload`: the
  // browser preload list is effectively permanent, and a host on it can no
  // longer be served over plain HTTP even briefly (for example while moving
  // the app). The header on its own is enough for returning visitors.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // ZapDesk uses none of these.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

/**
 * API routes return JSON and files, never pages, so they need no sources at
 * all. The proxy (which sets the page CSP) does not run on `/api`.
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * The page Content-Security-Policy. Scripts need the request's nonce — no
 * `'unsafe-inline'`; `'strict-dynamic'` lets those scripts load Next's chunks.
 *
 * `style-src` keeps `'unsafe-inline'`: React renders `style={...}` props as
 * inline style attributes (recharts and the avatar colours rely on them),
 * sonner injects a `<style>` tag at runtime, and sanitised DevOps HTML keeps
 * its inline `style` colours. A nonce cannot cover style attributes, and
 * listing a nonce would make browsers ignore `'unsafe-inline'`.
 *
 * `img-src` allows any HTTPS host: DevOps avatars and work item type icons
 * come from dev.azure.com and the legacy *.visualstudio.com / *.vsassets.io
 * hosts, GitHub avatars from avatars.githubusercontent.com, and sanitised
 * ticket HTML keeps any `https:` image (see SAFE_URI in sanitize-html.ts),
 * such as a customer's email signature logo. Images cannot run script, so a
 * host list would only turn those into broken images. Everything else the
 * browser talks to is our own `/api`.
 */
export function buildPageCsp(
  nonce: string,
  isDev = process.env.NODE_ENV === 'development'
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    // Dev needs the HMR websocket; production talks only to its own origin.
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
