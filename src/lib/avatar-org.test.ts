import { describe, it, expect, vi, afterEach } from 'vitest';
import { imageRequestDevOpsOrg } from './devops-org';
import { readIdentityField } from './devops';

/**
 * Which organisation an avatar image is fetched from (#674 review).
 *
 * An `<img>` cannot send `x-devops-org`, so a generated avatar URL names its
 * organisation in `?org=`. Without it the route fell back to the server
 * default, or answered 400 when none was set.
 */

const imageRequest = (query = '', org?: string) =>
  new Request(`https://zapdesk.test/api/devops/avatar/a1${query}`, {
    headers: org ? { 'x-devops-org': org } : {},
  });

describe('imageRequestDevOpsOrg', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('takes the organisation from ?org= when no header is sent', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', 'server-default');
    expect(imageRequestDevOpsOrg(imageRequest('?org=KnowAllTest'))).toBe('KnowAllTest');
  });

  it('still prefers the header', () => {
    expect(imageRequestDevOpsOrg(imageRequest('?org=Other', 'KnowAllTest'))).toBe('KnowAllTest');
  });

  it('falls back to the server default without either', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', 'server-default');
    expect(imageRequestDevOpsOrg(imageRequest())).toBe('server-default');
  });

  // Whatever is in ?org= ends up in a dev.azure.com URL.
  it('ignores a value that is not an organisation name', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', 'server-default');
    for (const bad of [
      '..%2F_apis',
      'a%2Fb',
      '-leading',
      'trailing-',
      'x'.repeat(51),
      'has%20space',
    ]) {
      expect(imageRequestDevOpsOrg(imageRequest(`?org=${bad}`))).toBe('server-default');
    }
  });
});

describe('the approver avatar URL', () => {
  it('names the organisation when DevOps gave no image', () => {
    expect(
      readIdentityField({ displayName: 'Alex Morgan', id: 'a1' }, 'KnowAllTest')?.avatarUrl
    ).toBe('/api/devops/avatar/a1?org=KnowAllTest');
  });

  it('keeps the image DevOps gave', () => {
    expect(
      readIdentityField(
        { displayName: 'Alex Morgan', id: 'a1', imageUrl: 'https://example.com/a1.png' },
        'KnowAllTest'
      )?.avatarUrl
    ).toBe('https://example.com/a1.png');
  });

  it('keeps the plain route when the organisation is not known', () => {
    expect(readIdentityField({ displayName: 'Alex Morgan', id: 'a1' })?.avatarUrl).toBe(
      '/api/devops/avatar/a1'
    );
  });
});
