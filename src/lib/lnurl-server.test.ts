import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { lookup as nodeDnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';

// `refusePrivateAddresses` is the one thing here that reaches a real IO
// boundary, so the resolver is mocked: what it decides must not depend on
// what the runner's DNS happens to answer (raised in review on #642).
vi.mock('node:dns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:dns')>()),
  lookup: vi.fn(),
}));
import {
  bolt11AmountMsat,
  fetchLnurlInvoice,
  isPrivateIp,
  parseLightningAddress,
  LnurlError,
  LNURL_DNS_TIMEOUT_MS,
  LNURL_MAX_RESPONSE_BYTES,
  refusePrivateAddresses,
} from '@/lib/lnurl-server';

// #627: the LNURL-pay round trip moved server-side, so it is guarded against
// SSRF. DNS and fetch are injected; nothing here touches the network.

// 210n = 21,000 msat = 21 sats, the amount every test asks for unless it says otherwise.
// A real bech32 checksum: the invoice is checked for one before the QR is
// shown, so a placeholder would be rejected (raised in review on #642).
const INVOICE = 'lnbc210n1pjexamplezapdesku7en7n';
const META = {
  tag: 'payRequest',
  callback: 'https://pay.example.com/lnurlp/callback/alex',
  minSendable: 1000,
  maxSendable: 100_000_000,
  commentAllowed: 10,
  metadata: '[["text/plain","Alex Morgan"]]',
};

const publicDns = vi.fn(async () => ['93.184.216.34']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch answering the metadata request, then the callback. */
function provider(meta: unknown = META, invoice: unknown = { pr: INVOICE }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return url.pathname.startsWith('/.well-known/lnurlp/') ? json(meta) : json(invoice);
  });
}

const run = (overrides: Partial<Parameters<typeof fetchLnurlInvoice>[0]> = {}) =>
  fetchLnurlInvoice({
    lightningAddress: 'alex@example.com',
    amountSats: 21,
    fetchImpl: provider() as unknown as typeof fetch,
    resolve: publicDns,
    ...overrides,
  });

describe('parseLightningAddress', () => {
  it('accepts name@domain, lower-cased', () => {
    expect(parseLightningAddress(' Alex.Morgan@Example.com ')).toEqual({
      name: 'alex.morgan',
      domain: 'example.com',
    });
  });

  it.each([
    'alex',
    'alex@',
    '@example.com',
    'a@b@example.com',
    'alex@localhost',
    'alex@127.0.0.1',
    'alex@example.com/evil',
    'alex@example.com:8080',
    'al ex@example.com',
  ])('rejects %s', (raw) => {
    expect(parseLightningAddress(raw)).toBeNull();
  });
});

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '0.0.0.0',
  ])('blocks %s', (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateIp(ip)).toBe(false)
  );
});

describe('fetchLnurlInvoice', () => {
  it('fetches metadata, then the callback with the amount in msat and the comment', async () => {
    const fetchImpl = provider();
    const invoice = await run({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      comment: 'ZapDesk Ticket #42',
    });
    expect(invoice).toBe(INVOICE);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://example.com/.well-known/lnurlp/alex');
    const callback = new URL(String(fetchImpl.mock.calls[1][0]));
    expect(callback.origin + callback.pathname).toBe(META.callback);
    expect(callback.searchParams.get('amount')).toBe('21000');
    // Truncated to commentAllowed.
    expect(callback.searchParams.get('comment')).toBe('ZapDesk Ti');
  });

  it('keeps query parameters the callback already has', async () => {
    const fetchImpl = provider({ ...META, callback: 'https://pay.example.com/cb?id=7' });
    await run({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const callback = new URL(String(fetchImpl.mock.calls[1][0]));
    expect(callback.searchParams.get('id')).toBe('7');
    expect(callback.searchParams.get('amount')).toBe('21000');
  });

  it('refuses redirects and sets a timeout', async () => {
    const fetchImpl = provider();
    await run({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // The fetch signal cannot cover the name check, which happens before it is
  // created, and `dns.lookup` takes no signal. Without its own deadline a
  // resolver that never answers holds the route open and the dialog never
  // leaves its loading state (raised in review on #642).
  it('gives up on a name lookup that never answers, instead of hanging', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = provider();
      const attempt = run({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        // Never settles, so the deadline is the only thing that can end it.
        resolve: () => new Promise<string[]>(() => {}),
      });
      const rejects = expect(attempt).rejects.toThrow(/Couldn't reach example\.com/);
      await vi.advanceTimersByTimeAsync(LNURL_DNS_TIMEOUT_MS + 1);
      await rejects;
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid address without fetching', async () => {
    const fetchImpl = provider();
    await expect(
      run({ lightningAddress: 'not-an-address', fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, -5, 1.5, 2_000_000, Number.NaN])('rejects amount %s', async (amountSats) => {
    await expect(run({ amountSats })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an amount outside the provider’s min/max', async () => {
    await expect(
      run({
        amountSats: 21,
        fetchImpl: provider({ ...META, minSendable: 100_000 }) as unknown as typeof fetch,
      })
    ).rejects.toThrow('at least 100 sats');
    await expect(
      run({
        amountSats: 21,
        fetchImpl: provider({ ...META, maxSendable: 10_000 }) as unknown as typeof fetch,
      })
    ).rejects.toThrow('at most 10 sats');
  });

  it('refuses a domain that resolves to a private address', async () => {
    const fetchImpl = provider();
    await expect(
      run({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: async () => ['169.254.169.254'],
      })
    ).rejects.toThrow('not a public host');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'http://pay.example.com/cb',
    'https://127.0.0.1/cb',
    'https://[::1]/cb',
    'https://localhost/cb',
    'https://pay.example.com:8443/cb',
    'not a url',
  ])('refuses callback %s', async (callback) => {
    const fetchImpl = provider({ ...META, callback });
    await expect(run({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(
      LnurlError
    );
    // Only the metadata request went out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes on an LNURL error reason', async () => {
    const fetchImpl = provider(META, { status: 'ERROR', reason: 'Amount too low' });
    await expect(run({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      'The Lightning provider said: Amount too low'
    );
  });

  it('reports an HTTP error from the provider', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(run({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      'returned an error (404)'
    );
  });

  it('refuses a response over the size limit', async () => {
    const big = 'x'.repeat(LNURL_MAX_RESPONSE_BYTES + 1);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ big }), { status: 200 }));
    await expect(run({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      'too large'
    );
  });

  it('reports a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    await expect(run({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      'took too long'
    );
  });

  it.each([{}, { pr: 42 }, { pr: 'bitcoin:abc' }, { pr: 'lnbc<script>' }])(
    'rejects a bad invoice %j',
    async (body) => {
      await expect(
        run({ fetchImpl: provider(META, body) as unknown as typeof fetch })
      ).rejects.toBeInstanceOf(LnurlError);
    }
  );

  // The shape check admits `b`, `i` and `o`, which bech32 excludes, and says
  // nothing about the checksum. An invoice that fails it reached the dialog,
  // which drew a QR code no wallet can pay: the sender scanned it and got the
  // failure in their wallet rather than an error and a Try again here
  // (raised in review on #642).
  it.each([
    ['one character altered', INVOICE.slice(0, -1) + (INVOICE.endsWith('q') ? 'p' : 'q')],
    ['characters bech32 has no place for', 'lnbc210n1pjexampleinvoicexyz'],
    // A valid prefix for the amount asked, so only the checksum's own length
    // guard can reject it.
    ['too few characters to hold a checksum', 'lnbc210n1qpzr'],
  ])('rejects an invoice with %s', async (_label, pr) => {
    await expect(
      run({ fetchImpl: provider(META, { pr }) as unknown as typeof fetch })
    ).rejects.toThrow('malformed invoice');
  });

  it.each([
    ['for another amount', 'lnbc10u1pjexamplezapdeskl8kw8g'],
    ['with no amount', 'lnbc1pjexamplezapdesk44qxd0'],
  ])('rejects an invoice %s', async (_label, pr) => {
    await expect(
      run({ fetchImpl: provider(META, { pr }) as unknown as typeof fetch })
    ).rejects.toThrow('not for the amount you chose');
  });
});

describe('bolt11AmountMsat', () => {
  it.each([
    ['lnbc1pjexample', null],
    ['lnbc21u1pjexample', BigInt(2_100_000)],
    ['lnbc210n1pjexample', BigInt(21_000)],
    ['lnbc2m1pjexample', BigInt(200_000_000)],
    ['lnbc1p1pjexample', undefined], // finer than a millisat
    ['lnbc10p1pjexample', BigInt(1)],
    ['lntb5u1pjexample', BigInt(500_000)],
    ['lnbcrt5u1pjexample', BigInt(500_000)],
    ['lnxx5u1pjexample', undefined],
  ])('reads %s', (invoice, expected) => {
    expect(bolt11AmountMsat(invoice)).toBe(expected);
  });
});

/**
 * The connect-time host check (#642). `assertSafeUrl` resolves a name, approves
 * it, and then the socket resolves it again -- so a host answering the first
 * lookup publicly and the second privately passed the check and still reached
 * an internal service. This judges the address at the point of connection,
 * where there is no later lookup to disagree with it.
 */
describe('refusePrivateAddresses', () => {
  const lookup = vi.mocked(nodeDnsLookup) as unknown as Mock;

  /** The resolver answers with `addresses`, or fails with `error`. */
  const resolving = (addresses: LookupAddress[], error: NodeJS.ErrnoException | null = null) =>
    lookup.mockImplementation(
      (
        _hostname: string,
        _options: LookupOptions,
        cb: (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void
      ) => cb(error, addresses)
    );

  const call = (hostname: string, options: LookupOptions = { all: true }) =>
    new Promise<{
      error: Error | null;
      addresses: string | LookupAddress[];
      family?: number;
    }>((resolve) => {
      refusePrivateAddresses(hostname, options, (error, addresses, family) =>
        resolve({ error, addresses, family })
      );
    });

  // A block body on purpose: `mockReset()` returns the mock, and a value
  // returned from `beforeEach` is treated as a teardown callback -- so the
  // arrow form had Vitest calling the mock with no arguments after each test.
  beforeEach(() => {
    lookup.mockReset();
  });

  it('refuses a name that resolves to loopback', async () => {
    resolving([{ address: '127.0.0.1', family: 4 }]);
    const { error, addresses } = await call('rebind.example.com');
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/not a public host/);
    // Nothing to connect to, so there is no address to misuse.
    expect(addresses).toEqual([]);
  });

  // Happy Eyeballs hands several addresses to the socket at once, so one
  // private address among public ones is still a way in.
  it('refuses the whole answer when only one address is private', async () => {
    resolving([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const { error } = await call('mixed.example.com');
    expect(error?.message).toMatch(/not a public host/);
  });

  it('allows an answer that is public throughout', async () => {
    const addresses = [{ address: '93.184.216.34', family: 4 }];
    resolving(addresses);
    expect(await call('pay.example.com')).toMatchObject({ error: null, addresses });
  });

  it('passes an error from the lookup through rather than approving', async () => {
    resolving([], Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const { error, addresses } = await call('nothing.invalid');
    expect(error).toBeInstanceOf(Error);
    expect(addresses).toEqual([]);
  });

  // Node asks for every address while Happy Eyeballs is on, which is the
  // default, but not under `autoSelectFamily: false`. A caller that did not
  // ask for all of them cannot read an array.
  it('answers in the single-address shape when all was not asked for', async () => {
    resolving([{ address: '93.184.216.34', family: 4 }]);
    expect(await call('pay.example.com', { all: false })).toMatchObject({
      error: null,
      addresses: '93.184.216.34',
      family: 4,
    });
  });
});
