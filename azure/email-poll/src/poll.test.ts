import { describe, it, expect, vi } from 'vitest';
import { drainMailbox, pollUrl, readConfig, POLL_TIMEOUT_MS, ERROR_BODY_CHARS } from './poll';

const ok = (body = 'fetched=1 ingested=1 failed=0') =>
  new Response(body, { status: 200, statusText: 'OK' });

describe('readConfig', () => {
  it('reads both settings', () => {
    expect(
      readConfig({ ZAPDESK_BASE_URL: 'https://zapdesk.knowall.ai', EMAIL_WEBHOOK_SECRET: 's' })
    ).toEqual({ baseUrl: 'https://zapdesk.knowall.ai', secret: 's' });
  });

  it('trims surrounding whitespace', () => {
    expect(readConfig({ ZAPDESK_BASE_URL: '  https://x  ', EMAIL_WEBHOOK_SECRET: ' s ' })).toEqual({
      baseUrl: 'https://x',
      secret: 's',
    });
  });

  // The GitHub workflow this replaces failed 100 runs in a row for exactly
  // this reason, so the message has to name what is missing and where to put
  // it — an Application Insights trace is all the operator gets.
  it('names every missing setting', () => {
    expect(() => readConfig({})).toThrow(/ZAPDESK_BASE_URL, EMAIL_WEBHOOK_SECRET/);
    expect(() => readConfig({ EMAIL_WEBHOOK_SECRET: 's' })).toThrow(/ZAPDESK_BASE_URL/);
    expect(() => readConfig({ ZAPDESK_BASE_URL: 'https://x' })).toThrow(/EMAIL_WEBHOOK_SECRET/);
  });

  it('treats a whitespace-only setting as missing', () => {
    expect(() => readConfig({ ZAPDESK_BASE_URL: '   ', EMAIL_WEBHOOK_SECRET: 's' })).toThrow(
      /ZAPDESK_BASE_URL/
    );
  });

  it('says where to set them', () => {
    expect(() => readConfig({})).toThrow(/Application settings/);
  });

  // The secret travels as a request header, and the receiving route can only
  // check it once it has already crossed the network. Over plain http to a
  // remote host that is a credential on the wire.
  it('refuses plain http to a remote host', () => {
    expect(() =>
      readConfig({ ZAPDESK_BASE_URL: 'http://zapdesk.knowall.ai', EMAIL_WEBHOOK_SECRET: 's' })
    ).toThrow(/must use https/);
  });

  it('allows plain http only for loopback, where nothing leaves the machine', () => {
    for (const host of ['http://localhost:3102', 'http://127.0.0.1:3102', 'http://[::1]:3102']) {
      expect(readConfig({ ZAPDESK_BASE_URL: host, EMAIL_WEBHOOK_SECRET: 's' }).baseUrl).toBe(host);
    }
  });

  // `localhost.evil.example` and `127.0.0.1.evil.example` both resolve
  // elsewhere; only an exact loopback host is safe over http.
  it('is not fooled by a hostname that merely starts with a loopback name', () => {
    for (const host of ['http://localhost.evil.example', 'http://127.0.0.1.evil.example']) {
      expect(() => readConfig({ ZAPDESK_BASE_URL: host, EMAIL_WEBHOOK_SECRET: 's' })).toThrow(
        /must use https/
      );
    }
  });

  it('always allows https', () => {
    expect(
      readConfig({ ZAPDESK_BASE_URL: 'https://zapdesk.knowall.ai', EMAIL_WEBHOOK_SECRET: 's' })
        .baseUrl
    ).toBe('https://zapdesk.knowall.ai');
  });

  it('rejects a base URL that is not a URL', () => {
    expect(() =>
      readConfig({ ZAPDESK_BASE_URL: 'zapdesk.knowall.ai', EMAIL_WEBHOOK_SECRET: 's' })
    ).toThrow(/not a valid URL/);
  });

  it('rejects a scheme that is neither http nor https', () => {
    expect(() =>
      readConfig({ ZAPDESK_BASE_URL: 'ftp://zapdesk.knowall.ai', EMAIL_WEBHOOK_SECRET: 's' })
    ).toThrow(/must use https/);
  });
});

describe('pollUrl', () => {
  it('appends the poll route', () => {
    expect(pollUrl('https://zapdesk.knowall.ai')).toBe('https://zapdesk.knowall.ai/api/email/poll');
  });

  it('does not double the slash', () => {
    expect(pollUrl('https://zapdesk.knowall.ai/')).toBe(
      'https://zapdesk.knowall.ai/api/email/poll'
    );
    expect(pollUrl('https://zapdesk.knowall.ai///')).toBe(
      'https://zapdesk.knowall.ai/api/email/poll'
    );
  });
});

describe('drainMailbox', () => {
  const config = { baseUrl: 'https://zapdesk.knowall.ai', secret: 'shh' };

  it('posts to the poll route with the shared secret', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await drainMailbox(config, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://zapdesk.knowall.ai/api/email/poll');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-webhook-secret']).toBe('shh');
  });

  it('returns the body for logging', async () => {
    const fetchImpl = vi.fn(async () => ok('fetched=3 ingested=3 failed=0'));
    await expect(drainMailbox(config, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      'fetched=3 ingested=3 failed=0'
    );
  });

  // `fetch` resolves for 4xx and 5xx, so without this a failed poll would be
  // recorded as a successful invocation — the silent failure mode that let the
  // old workflow rot unnoticed.
  it.each([
    [401, 'Unauthorized'],
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
  ])('throws on HTTP %i rather than reporting success', async (status, statusText) => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status, statusText }));
    await expect(drainMailbox(config, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      new RegExp(`Poll failed: ${status}`)
    );
  });

  it('includes the response body in the error, truncated', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(2000), { status: 500 }));
    await expect(drainMailbox(config, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      new RegExp(`x{${ERROR_BODY_CHARS}}(?!x)`)
    );
  });

  // A failing poll can carry an upstream Graph error of unbounded size. The
  // timeout bounds how long a response takes, not how large it is, so the read
  // is abandoned once there is enough to report rather than buffered whole.
  it('stops reading an oversized body instead of buffering it', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('y'.repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 200) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const fetchImpl = vi.fn(async () => new Response(body, { status: 500 }));
    await expect(drainMailbox(config, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /truncated/
    );

    // 500 chars needs one 1 KiB chunk; anything close to 200 means it drained
    // the whole stream.
    expect(pulled).toBeLessThan(5);
  });

  it('caps a successful body too', async () => {
    const fetchImpl = vi.fn(async () => ok('z'.repeat(20_000)));
    const out = await drainMailbox(config, fetchImpl as unknown as typeof fetch);
    expect(out.length).toBeLessThan(20_000);
    expect(out).toMatch(/truncated/);
  });

  it('bounds the request so an overrun cannot hold the invocation open', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await drainMailbox(config, fetchImpl as unknown as typeof fetch);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(POLL_TIMEOUT_MS).toBe(90_000);
  });

  it('propagates a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    await expect(drainMailbox(config, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /ENOTFOUND/
    );
  });
});
