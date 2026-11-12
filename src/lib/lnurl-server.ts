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
 * no private / loopback / link-local hosts, a timeout and a response size cap.
 *
 * The host check happens twice, and that is deliberate. {@link assertSafeUrl}
 * runs before the request, so a refusal can say which rule the provider broke.
 * But a name resolved before a request is not the name the socket connects to:
 * a host can answer the check with a public address and the connection with a
 * private one, which is DNS rebinding, and the pre-flight check cannot see it.
 * {@link refusePrivateAddresses} is therefore wired into the connection itself,
 * where the address being used is the address being judged. That one is the
 * real control; the pre-flight check is for the error message.
 *
 * Server only: imports `node:dns`.
 */
import { lookup } from 'node:dns/promises';
import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/** How long each LNURL request may take. */
export const LNURL_TIMEOUT_MS = 8_000;
/** How long the name check before each request may take. */
export const LNURL_DNS_TIMEOUT_MS = 3_000;
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
 * A `net.connect` name lookup that refuses to hand back a private address.
 *
 * This is the SSRF control that cannot be side-stepped by timing. The check in
 * {@link assertSafeUrl} resolves the name, approves it, and then `fetch`
 * resolves it again when it opens the socket -- so a host that answers the
 * first lookup with a public address and the second with a private one passes
 * the check and still reaches an internal service. Judging the address at the
 * point of connection closes that window, because there is no second lookup
 * after it (raised in review on #642).
 *
 * Node calls this with `{ all: true }` and expects `(err, [{address, family}])`
 * -- it uses several addresses at once for Happy Eyeballs, so every one of
 * them has to be acceptable, not just the first.
 */
export function refusePrivateAddresses(
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: string | LookupAddress[],
    family?: number
  ) => void
): void {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    // `net.connect`'s contract wants an address argument either way; callers
    // read the error first, so an empty list is the honest thing to send with
    // one.
    if (error) {
      callback(error, []);
      return;
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
      callback(new Error(`${hostname} is not a public host`), []);
      return;
    }
    // Every address is checked whatever the caller asked for, but the answer
    // has to be in the shape it asked for: a caller that did not ask for all
    // of them expects `(error, address, family)`, and would make nothing of an
    // array. Node asks for all of them while Happy Eyeballs is on, which is
    // the default; it is off under `autoSelectFamily: false`, and was the
    // default on older Node, where returning an array would fail every LNURL
    // connection (raised in review on #642).
    if (options.all !== true) {
      callback(null, addresses[0].address, addresses[0].family);
      return;
    }
    callback(null, addresses);
  });
}

/**
 * The dispatcher every LNURL request uses, so the address the socket connects
 * to is the address that was judged. Scoped to this module on purpose: a
 * global dispatcher would change every other outbound request in the app.
 */
const lnurlDispatcher = new Agent({ connect: { lookup: refusePrivateAddresses } });

/**
 * `work`, or a rejection once `ms` has passed.
 *
 * The request itself is bounded by `AbortSignal.timeout`, but that signal is
 * created after the name check, and `dns.lookup` takes no signal. A resolver
 * that never settles would hold the invoice route open for as long as the
 * platform allows, and the dialog would sit on its loading state -- with
 * neither the error nor the Try again this route exists to provide (raised in
 * review on #642).
 *
 * `Promise.race` attaches a handler to `work` either way, so a rejection that
 * arrives after the deadline is still handled and does not surface as an
 * unhandled rejection.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
    addresses = await withDeadline(resolve(hostname), LNURL_DNS_TIMEOUT_MS);
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
      // Not part of the DOM `RequestInit`, so it needs the cast; undici's own
      // fetch reads it, which is why that is the default transport below. A
      // test's injected fetch ignores it.
      dispatcher: lnurlDispatcher,
    } as RequestInit);
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

/**
 * BOLT11-looking: `ln` prefix, lower-case alphanumerics, long enough to hold a
 * separator and a checksum. A shape check only -- it admits `b`, `i`, `o` and
 * `1`, which bech32's data part excludes, so {@link hasValidBech32Checksum}
 * is what actually decides.
 */
const BOLT11_PATTERN = /^ln[0-9a-z]{8,}$/;
const MAX_INVOICE_LENGTH = 4096;

/** Bech32 data characters (BIP-173). `1` separates them from the prefix. */
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** BIP-173 checksum accumulator over 5-bit groups. */
function bech32Polymod(values: readonly number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk;
}

/**
 * Whether `invoice` carries a valid bech32 checksum.
 *
 * BOLT11 is bech32 as BIP-173 defines it -- not bech32m, and without bech32's
 * 90-character ceiling, since an invoice routinely exceeds it.
 *
 * Without this, an invoice whose checksum is wrong passed the shape check and
 * went to the dialog, which rendered a QR code no wallet can pay: the sender
 * saw a code, scanned it, and got a failure in their wallet rather than an
 * error and a Try again here (raised in review on #642).
 *
 * This is a transcription check, not an authenticity one. Verifying the
 * provider's signature needs secp256k1 public-key recovery, which is not a
 * dependency of this project, so it is deliberately not attempted.
 */
export function hasValidBech32Checksum(invoice: string): boolean {
  // The data part runs from the *last* `1` to the end: the prefix may contain
  // one, as `lnbc1p...` does when the invoice carries no amount.
  const separator = invoice.lastIndexOf('1');
  // At least one prefix character, and at least the six checksum characters.
  if (separator < 1 || invoice.length - separator - 1 < 6) return false;
  const prefix = invoice.slice(0, separator);
  const data: number[] = [];
  for (const character of invoice.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(character);
    if (value === -1) return false;
    data.push(value);
  }
  const expandedPrefix: number[] = [];
  for (const character of prefix) expandedPrefix.push(character.charCodeAt(0) >>> 5);
  expandedPrefix.push(0);
  for (const character of prefix) expandedPrefix.push(character.charCodeAt(0) & 31);
  return bech32Polymod([...expandedPrefix, ...data]) === 1;
}

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
  // undici's fetch rather than the global one: it is the same implementation
  // Node's `fetch` is built on, but it honours the `dispatcher` that carries
  // the connect-time host check.
  fetchImpl = undiciFetch as unknown as typeof fetch,
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
  if (
    invoice.length > MAX_INVOICE_LENGTH ||
    !BOLT11_PATTERN.test(invoice) ||
    !hasValidBech32Checksum(invoice)
  ) {
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
