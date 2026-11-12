/**
 * What happens when undici cannot be loaded (#646).
 *
 * In its own file because mocking `undici` to fail has to apply to the whole
 * module graph, which the rest of the LNURL tests do not want.
 *
 * v0.22.0 shipped `undici@^8`, which needs Node 22 for `Promise.withResolvers`.
 * The import and the dispatcher both sat at module scope, so on an older Node
 * the module threw while initialising: `/api/lightning/invoice` answered 500
 * to everything, never reaching its own auth check, and the Zap dialog showed
 * "Couldn't fetch a Lightning invoice (500)".
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('undici', () => {
  throw new Error("Cannot find module 'undici'");
});

const publicDns = async () => ['93.184.216.34'];

describe('when undici cannot be loaded', () => {
  it('still imports the module, rather than failing at module scope', async () => {
    // The import itself is the assertion: if this module threw on load, the
    // route could not answer anything, which is the bug.
    const lnurl = await import('@/lib/lnurl-server');
    expect(typeof lnurl.fetchLnurlInvoice).toBe('function');
  });

  it('fails the request with a handled error instead of crashing', async () => {
    const { fetchLnurlInvoice, LnurlError } = await import('@/lib/lnurl-server');
    const attempt = fetchLnurlInvoice({
      lightningAddress: 'alex@example.com',
      amountSats: 21,
      resolve: publicDns,
    });
    await expect(attempt).rejects.toBeInstanceOf(LnurlError);
    await expect(attempt).rejects.toMatchObject({ status: 500 });
  });

  it('does not fall back to an unguarded fetch', async () => {
    // Failing closed is the point: a transport without the dispatcher has no
    // connect-time host check, so reaching the provider anyway would drop the
    // SSRF control exactly when something is already wrong.
    const unguarded = vi.fn();
    vi.stubGlobal('fetch', unguarded);
    const { fetchLnurlInvoice } = await import('@/lib/lnurl-server');
    await expect(
      fetchLnurlInvoice({
        lightningAddress: 'alex@example.com',
        amountSats: 21,
        resolve: publicDns,
      })
    ).rejects.toThrow();
    expect(unguarded).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
