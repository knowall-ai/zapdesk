/**
 * Security headers shared by `next.config.ts` (every response, static assets
 * included) and `src/proxy.ts` (the per-request, nonce-based CSP on pages).
 *
 * ZapDesk is not embedded anywhere (it is not a Teams tab), so framing is
 * denied outright with both `X-Frame-Options` and CSP `frame-ancestors`.
 */

export const BASELINE_SECURITY_HEADERS: { key: string; value: string }[] = [
  // Two years. No `preload`: that would bind every *.knowall.ai host to HTTPS
  // for good, and not every subdomain has been confirmed as HTTPS-only.
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
 * Hosts the browser loads images from directly: DevOps identity avatars and
 * work item type icons (served from dev.azure.com and the legacy
 * *.visualstudio.com / *.vsassets.io hosts), plus images inlined in ticket
 * HTML. Everything else the browser talks to is our own `/api`.
 */
const DEVOPS_IMAGE_HOSTS = [
  'https://dev.azure.com',
  'https://*.dev.azure.com',
  'https://*.visualstudio.com',
  'https://*.vsassets.io',
];

/**
 * The page Content-Security-Policy. Scripts need the request's nonce — no
 * `'unsafe-inline'`; `'strict-dynamic'` lets those scripts load Next's chunks.
 *
 * `style-src` keeps `'unsafe-inline'`: React renders `style={...}` props as
 * inline style attributes (recharts and the avatar colours rely on them),
 * sonner injects a `<style>` tag at runtime, and sanitised DevOps HTML keeps
 * its inline `style` colours. A nonce cannot cover style attributes, and
 * listing a nonce would make browsers ignore `'unsafe-inline'`.
 */
export function buildPageCsp(
  nonce: string,
  isDev = process.env.NODE_ENV === 'development'
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${DEVOPS_IMAGE_HOSTS.join(' ')}`,
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
