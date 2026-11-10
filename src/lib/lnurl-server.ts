/**
 * Server-side LNURL-pay: Lightning address -> BOLT11 invoice (#627).
 *
 * The Zap dialog used to run this chain in the browser, but the production
 * Content-Security-Policy only allows `connect-src 'self'`, so the request to
 * the recipient's `/.well-known/lnurlp/...` endpoint was blocked and the QR
 * code never appeared. Widening the CSP to "any host" would undo the point of
 * having one, so the server makes these requests and the browser only talks
 * to our own origin.
 *
 * Because the server now fetches URLs a user (or a remote LNURL service)
 * chooses, every request is guarded against SSRF: https only, no redirects,
 * no private / loopback / link-local hosts (checked on the literal hostname
 * and on what it resolves to), a timeout and a response size cap.
 *
 * Server only: imports `node:dns`.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** How long each LNURL request may take. */
export const LNURL_TIMEOUT_MS = 8_000;
/** LNURL responses are small JSON documents; anything bigger is refused. */
export const LNURL_MAX_RESPONSE_BYTES = 64 * 1024;
/** Bounds for a zap, in whole sats (mirrors the Zap dialog). */
export const MIN_ZAP_SATS = 1;
export const MAX_ZAP_SATS = 1_000_000;

/** A failure whose message is safe and meaningful to show the sender. */
export class LnurlError extends Error {
  constructor(
    message: string,
    /** HTTP status for our own route: 400 for bad input, 502 for the provider. */
    readonly status: number = 502
  ) {
    super(message);
    this.name = 'LnurlError';
  }
}

export interface LightningAddress {
  name: string;
  domain: string;
}

// LUD-16: the name is a-z0-9-_.+ ; the domain is an ordinary DNS hostname.
const NAME_PATTERN = /^[a-z0-9._+-]{1,64}$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Parse `name@domain`, or `null` if it is not a valid Lightning address. */
export function parseLightningAddress(raw: string): LightningAddress | null {
  const value = raw.trim().toLowerCase();
  const parts = value.split('@');
  if (parts.length !== 2) return null;
  const [name, domain] = parts;
  if (!NAME_PATTERN.test(name) || !DOMAIN_PATTERN.test(domain)) return null;
  return { name, domain };
}

/** True for an IP address that must never be fetched from the server. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') || // link-local
      lower.startsWith('ff') // multicast
    );
  }
  return false;
}

/** Resolves a hostname to its addresses; injectable for tests. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * Throw unless `url` is an https URL on a public host.
 *
 * This is a check made before the request, so a DNS answer that changes
 * between here and the fetch is not caught; together with the hostname
 * checks and refusing redirects it still closes off the plain cases.
 */
export async function assertSafeUrl(url: URL, resolve: HostResolver): Promise<void> {
  if (url.protocol !== 'https:') {
    throw new LnurlError('The Lightning provider must use HTTPS');
  }
  if (url.username || url.password) {
    throw new LnurlError('The Lightning provider returned an invalid URL');
  }
  if (url.port && url.port !== '443') {
    throw new LnurlError('The Lightning provider returned an unsupported URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !hostname.includes('.')
  ) {
    throw new LnurlError('The Lightning provider is not a public host');
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new LnurlError('The Lightning provider is not a public host');
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new LnurlError(`Couldn't reach ${hostname}`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new LnurlError('The Lightning provider is not a public host');
  }
}

/** Read at most `LNURL_MAX_RESPONSE_BYTES` of a response as JSON. */
async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > LNURL_MAX_RESPONSE_BYTES) {
    throw new LnurlError('The Lightning provider sent too large a response');
  }
  if (!response.body) throw new LnurlError('The Lightning provider sent an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LNURL_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new LnurlError('The Lightning provider sent too large a response');
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new LnurlError('The Lightning provider sent an invalid response');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An LNURL `{status: "ERROR", reason}` body, as a short plain-text message. */
function providerReason(body: unknown): string | null {
  if (!isRecord(body) || body.status !== 'ERROR') return null;
  const reason = typeof body.reason === 'string' ? body.reason : '';
  // Plain text only, kept short: it is shown in the dialog.
  const clean = reason.replace(/[^\x20-\x7e]/g, '').slice(0, 200);
  return clean ? `The Lightning provider said: ${clean}` : 'The Lightning provider refused';
}

async function getJson(url: URL, fetchImpl: typeof fetch, resolve: HostResolver): Promise<unknown> {
  await assertSafeUrl(url, resolve);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(LNURL_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new LnurlError(`${url.hostname} took too long to respond`);
    }
    throw new LnurlError(`Couldn't reach ${url.hostname}`);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await readJson(response);
    } catch {
      // The status is enough.
    }
    throw new LnurlError(
      providerReason(body) ?? `The Lightning provider returned an error (${response.status})`
    );
  }
  const body = await readJson(response);
  const reason = providerReason(body);
  if (reason) throw new LnurlError(reason);
  return body;
}

export interface FetchInvoiceOptions {
  lightningAddress: string;
  amountSats: number;
  /** Note shown in the recipient's wallet, if the provider accepts one. */
  comment?: string;
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
}

/** BOLT11-looking: `ln` prefix, bech32 characters only. */
const BOLT11_PATTERN = /^ln[0-9a-z]{8,}$/;
const MAX_INVOICE_LENGTH = 4096;

/** BOLT11 human-readable part: `ln` + network + optional amount + multiplier. */
const BOLT11_HRP_PATTERN = /^ln(?:bcrt|bc|tbs|tb|sb)(?:([1-9]\d*)([munp])?)?$/;
/** Millisats per unit of each BOLT11 multiplier (none = whole bitcoin). */
const MSAT_PER_UNIT: Record<string, bigint> = {
  '': BigInt(100_000_000_000),
  m: BigInt(100_000_000),
  u: BigInt(100_000),
  n: BigInt(100),
};

/**
 * The amount a BOLT11 invoice asks for, in millisats; `null` when the
 * invoice carries no amount, `undefined` when its prefix can't be read.
 */
export function bolt11AmountMsat(invoice: string): bigint | null | undefined {
  const separator = invoice.lastIndexOf('1');
  if (separator < 0) return undefined;
  const match = invoice.slice(0, separator).match(BOLT11_HRP_PATTERN);
  if (!match) return undefined;
  const [, digits, multiplier = ''] = match;
  if (!digits) return null;
  const value = BigInt(digits);
  if (multiplier === 'p') {
    // Pico-bitcoin: 10 per millisat; anything finer can't be paid.
    return value % BigInt(10) === BigInt(0) ? value / BigInt(10) : undefined;
  }
  return value * MSAT_PER_UNIT[multiplier];
}

/**
 * Fetch a BOLT11 invoice for `amountSats` from a Lightning address's
 * LNURL-pay service (LUD-06 / LUD-16). Throws `LnurlError` with a message
 * suitable for the sender.
 */
export async function fetchLnurlInvoice({
  lightningAddress,
  amountSats,
  comment,
  fetchImpl = fetch,
  resolve = defaultResolver,
}: FetchInvoiceOptions): Promise<string> {
  const address = parseLightningAddress(lightningAddress);
  if (!address) throw new LnurlError('Invalid Lightning address', 400);
  if (!Number.isInteger(amountSats) || amountSats < MIN_ZAP_SATS || amountSats > MAX_ZAP_SATS) {
    throw new LnurlError(
      `Amount must be a whole number of sats from ${MIN_ZAP_SATS} to ${MAX_ZAP_SATS.toLocaleString('en-US')}`,
      400
    );
  }

  const metaUrl = new URL(
    `https://${address.domain}/.well-known/lnurlp/${encodeURIComponent(address.name)}`
  );
  const meta = await getJson(metaUrl, fetchImpl, resolve);
  if (!isRecord(meta) || typeof meta.callback !== 'string') {
    throw new LnurlError('The Lightning provider sent no payment details');
  }
  if (meta.tag !== undefined && meta.tag !== 'payRequest') {
    throw new LnurlError('The Lightning address does not accept payments');
  }

  let callback: URL;
  try {
    callback = new URL(meta.callback);
  } catch {
    throw new LnurlError('The Lightning provider returned an invalid URL');
  }

  const amountMsat = amountSats * 1000;
  const minSendable = Number(meta.minSendable);
  const maxSendable = Number(meta.maxSendable);
  if (Number.isFinite(minSendable) && minSendable > 0 && amountMsat < minSendable) {
    throw new LnurlError(
      `This Lightning address accepts at least ${Math.ceil(minSendable / 1000).toLocaleString('en-US')} sats`,
      400
    );
  }
  if (Number.isFinite(maxSendable) && maxSendable > 0 && amountMsat > maxSendable) {
    throw new LnurlError(
      `This Lightning address accepts at most ${Math.floor(maxSendable / 1000).toLocaleString('en-US')} sats`,
      400
    );
  }

  callback.searchParams.set('amount', String(amountMsat));
  const commentAllowed = Number(meta.commentAllowed);
  if (comment && Number.isInteger(commentAllowed) && commentAllowed > 0) {
    callback.searchParams.set('comment', comment.slice(0, commentAllowed));
  }

  const invoiceBody = await getJson(callback, fetchImpl, resolve);
  const pr = isRecord(invoiceBody) ? invoiceBody.pr : undefined;
  if (typeof pr !== 'string' || !pr) {
    throw new LnurlError('The Lightning provider sent no invoice');
  }
  const invoice = pr.trim().toLowerCase();
  if (invoice.length > MAX_INVOICE_LENGTH || !BOLT11_PATTERN.test(invoice)) {
    throw new LnurlError('The Lightning provider sent a malformed invoice');
  }
  // LUD-06: the wallet must check the invoice is for the amount asked. A
  // provider that ignored it (or sent an open-amount invoice) would have the
  // QR ask for something other than what the sender chose.
  const invoiceMsat = bolt11AmountMsat(invoice);
  if (invoiceMsat === undefined) {
    throw new LnurlError('The Lightning provider sent a malformed invoice');
  }
  if (invoiceMsat !== BigInt(amountMsat)) {
    throw new LnurlError("The Lightning provider's invoice is not for the amount you chose");
  }
  return invoice;
}
