import { describe, expect, it } from 'vitest';
import { API_CSP, BASELINE_SECURITY_HEADERS, buildPageCsp } from './security-headers';

describe('buildPageCsp', () => {
  it('allows scripts only by nonce in production', () => {
    const csp = buildPageCsp('abc123', false);
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('lets images come from any HTTPS host, as the HTML sanitiser does', () => {
    const csp = buildPageCsp('abc123', false);
    const imgSrc = csp.split('; ').find((d) => d.startsWith('img-src'));
    expect(imgSrc).toBe("img-src 'self' blob: data: https:");
  });

  it('adds only what the dev server needs in development', () => {
    const csp = buildPageCsp('abc123', true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('API_CSP', () => {
  it('gives API responses no sources and no framing', () => {
    expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe('BASELINE_SECURITY_HEADERS', () => {
  it('denies framing and sets HSTS without preload', () => {
    const byKey = Object.fromEntries(BASELINE_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
  });
});
