import { describe, it, expect, vi } from 'vitest';
import { describeAadError, extractAadCode, verifyMailCredentials } from './mail-credentials';

const creds = {
  tenantId: 'f36f6414-cb7d-4545-9cf2-7574f7b5c584',
  clientId: '2432da2a-8d42-42a5-afec-e3e5bdae4fbe',
  clientSecret: 'a-secret',
};

const aadError = (description: string, status = 401) =>
  new Response(JSON.stringify({ error: 'invalid_client', error_description: description }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// The real thing, taken verbatim from the failing production poll.
const EXPIRED_SECRET =
  "AADSTS7000222: The provided client secret keys for app '2432da2a-8d42-42a5-afec-e3e5bdae4fbe' " +
  'are expired. Visit the Azure portal to create new keys for your app: https://aka.ms/NewClientSecret. ' +
  'Trace ID: f6048870-ab84-418f-9c1e-121273136900 Correlation ID: 5f589be8-af4b-4cd9-9eb4-528975f1e4e6';

describe('extractAadCode', () => {
  it('finds the code in a real error', () => {
    expect(extractAadCode(EXPIRED_SECRET)).toBe('AADSTS7000222');
  });

  it('returns nothing when there is no code', () => {
    expect(extractAadCode('something went wrong')).toBeUndefined();
  });
});

describe('describeAadError', () => {
  it('explains an expired secret and says how to fix it', () => {
    const result = describeAadError(EXPIRED_SECRET);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AADSTS7000222');
    expect(result.message).toMatch(/expired/i);
    expect(result.hint).toMatch(/Certificates & secrets/);
  });

  // Trace and correlation IDs change on every call; carrying them into a status
  // view makes two identical failures look like different problems.
  it('drops the trace and correlation IDs', () => {
    const result = describeAadError(EXPIRED_SECRET);
    expect(result.message).not.toMatch(/Trace ID/);
    expect(result.message).not.toMatch(/Correlation ID/);
  });

  it('distinguishes a wrong secret from an expired one', () => {
    const result = describeAadError('AADSTS7000215: Invalid client secret provided.');
    expect(result.code).toBe('AADSTS7000215');
    expect(result.message).toMatch(/wrong/i);
    expect(result.hint).toMatch(/secret ID/);
  });

  it('explains an unknown client id', () => {
    const result = describeAadError(
      "AADSTS700016: Application with identifier 'abc' was not found in the directory."
    );
    expect(result.code).toBe('AADSTS700016');
    expect(result.hint).toMatch(/MAIL_CLIENT_ID/);
  });

  it('passes an unrecognised code through with its first sentence', () => {
    const result = describeAadError('AADSTS50000: Something novel happened. Trace ID: abc');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AADSTS50000');
    expect(result.message).toBe('AADSTS50000: Something novel happened.');
    expect(result.hint).toMatch(/MAIL_CLIENT_SECRET/);
  });

  it('copes with no code at all', () => {
    const result = describeAadError('the directory is on fire');
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.message).toBe('the directory is on fire');
  });
});

describe('verifyMailCredentials', () => {
  it('reports ok when Entra ID issues a token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"access_token":"t"}', { status: 200 }));
    await expect(
      verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({ ok: true });
  });

  it('reports the expired secret from a real failure', async () => {
    const fetchImpl = vi.fn(async () => aadError(EXPIRED_SECRET));
    const result = await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AADSTS7000222');
  });

  it('says so when nothing is configured, without calling out', async () => {
    const fetchImpl = vi.fn();
    const result = await verifyMailCredentials(
      { tenantId: '', clientId: '', clientSecret: '' },
      fetchImpl as unknown as typeof fetch
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a network failure rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const result = await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not reach Entra ID/);
  });

  it('copes with a non-JSON error body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    const result = await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/502/);
  });

  // The whole point of this module: a cached token outlives the secret that
  // made it by up to an hour, so the check has to ask Entra ID every time.
  it('always calls Entra ID rather than reusing a token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"access_token":"t"}', { status: 200 }));
    await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never puts the client secret in the result', async () => {
    const fetchImpl = vi.fn(async () => aadError(EXPIRED_SECRET));
    const result = await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);
    expect(JSON.stringify(result)).not.toContain(creds.clientSecret);
  });

  it('requests a client-credentials token for Graph', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"access_token":"t"}', { status: 200 }));
    await verifyMailCredentials(creds, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(creds.tenantId);
    expect(url).toContain('/oauth2/v2.0/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
  });
});
