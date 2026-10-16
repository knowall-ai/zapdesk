import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminConsentUrl, installStateMatches, readInstallCallback } from './install';

// "Install for my organisation" (#457): the admin-consent link, and reading
// what Microsoft sends back.

const TENANT = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
const params = (values: Record<string, string>) => new URLSearchParams(values);

describe('install', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sends the admin to the consent page for this app, coming back to the callback', () => {
    vi.stubEnv('AZURE_AD_CLIENT_ID', 'client-123');
    vi.stubEnv('NEXTAUTH_URL', 'https://zapdesk.example.test/');

    const url = new URL(adminConsentUrl('abc'));

    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/organizations/adminconsent'
    );
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://zapdesk.example.test/api/install/callback'
    );
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('accepts only the state this browser was given', () => {
    expect(installStateMatches('abc', 'abc')).toBe(true);
    expect(installStateMatches('abd', 'abc')).toBe(false);
    expect(installStateMatches('abc', undefined)).toBe(false);
    expect(installStateMatches(null, 'abc')).toBe(false);
  });

  it('reports an install', () => {
    expect(
      readInstallCallback(params({ admin_consent: 'True', tenant: TENANT, state: 's' }), 's')
    ).toEqual({ ok: true, tenant: TENANT });
  });

  it('rejects an answer to a request this browser did not start', () => {
    expect(
      readInstallCallback(params({ admin_consent: 'True', tenant: TENANT, state: 'forged' }), 's')
    ).toEqual({ ok: false, reason: 'state' });
  });

  it('tells a declined consent from a failure, keeping only the Entra code', () => {
    expect(
      readInstallCallback(
        params({
          error: 'access_denied',
          error_description: 'AADSTS65004: User declined to consent. <script>',
          state: 's',
        }),
        's'
      )
    ).toEqual({ ok: false, reason: 'declined', detail: 'AADSTS65004' });

    expect(readInstallCallback(params({ error: 'invalid_request', state: 's' }), 's')).toEqual({
      ok: false,
      reason: 'failed',
      detail: 'invalid_request',
    });
  });

  it('does not report an install without consent or a tenant id', () => {
    expect(
      readInstallCallback(params({ admin_consent: 'False', tenant: TENANT, state: 's' }), 's')
    ).toMatchObject({ ok: false, reason: 'failed' });
    expect(
      readInstallCallback(params({ admin_consent: 'True', tenant: 'evil', state: 's' }), 's')
    ).toMatchObject({ ok: false, reason: 'failed' });
  });
});
