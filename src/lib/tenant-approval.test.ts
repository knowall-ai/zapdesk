import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  KNOWALL_TENANT_ID,
  accessRequestMailto,
  isOpenPath,
  isTenantApproved,
  notApprovedView,
  organisationLabel,
} from './tenant-approval';

// Approved organisations only: KnowAll, the tenant running ZapDesk, and the
// tenants listed in APPROVED_TENANT_IDS. Nothing else, and never a missing tid.

const CONTOSO = '11111111-2222-4333-8444-555555555555';
const FABRIKAM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('isTenantApproved', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('approves the KnowAll tenant with no configuration', () => {
    vi.stubEnv('APPROVED_TENANT_IDS', '');
    vi.stubEnv('AZURE_AD_TENANT_ID', '');
    expect(isTenantApproved(KNOWALL_TENANT_ID)).toBe(true);
    expect(isTenantApproved(KNOWALL_TENANT_ID.toUpperCase())).toBe(true);
  });

  it('approves tenants listed in APPROVED_TENANT_IDS, ignoring case and spaces', () => {
    vi.stubEnv('APPROVED_TENANT_IDS', ` ${CONTOSO.toUpperCase()} ,not-a-guid,, ${FABRIKAM}`);
    expect(isTenantApproved(CONTOSO)).toBe(true);
    expect(isTenantApproved(FABRIKAM.toUpperCase())).toBe(true);
  });

  it('approves the tenant running ZapDesk (AZURE_AD_TENANT_ID)', () => {
    vi.stubEnv('APPROVED_TENANT_IDS', '');
    vi.stubEnv('AZURE_AD_TENANT_ID', CONTOSO);
    expect(isTenantApproved(CONTOSO)).toBe(true);
  });

  it('turns away a tenant that is not on the list', () => {
    vi.stubEnv('APPROVED_TENANT_IDS', CONTOSO);
    vi.stubEnv('AZURE_AD_TENANT_ID', KNOWALL_TENANT_ID);
    expect(isTenantApproved(FABRIKAM)).toBe(false);
  });

  it('never approves a missing or malformed tid, and has no default tenant', () => {
    vi.stubEnv('APPROVED_TENANT_IDS', CONTOSO);
    vi.stubEnv('AZURE_AD_TENANT_ID', 'organizations');
    for (const tid of [undefined, null, '', '   ', 'common', 'organizations', 'not-a-guid', 42]) {
      expect(isTenantApproved(tid)).toBe(false);
    }
    // A list entry that is not a GUID approves nothing
    vi.stubEnv('APPROVED_TENANT_IDS', '*');
    expect(isTenantApproved('*')).toBe(false);
  });
});

describe('access request email', () => {
  it('is addressed to hello@knowall.ai with the app, organisation, tenant and email filled in', () => {
    const href = accessRequestMailto({
      app: 'ZapDesk',
      organisation: 'contoso.example',
      tenantId: CONTOSO,
      email: 'alex.morgan@contoso.example',
    });
    expect(href.startsWith('mailto:hello@knowall.ai?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('subject')).toBe('ZapDesk access request');
    const body = params.get('body') ?? '';
    expect(body).toContain('App: ZapDesk');
    expect(body).toContain('Organisation: contoso.example');
    expect(body).toContain(`Tenant ID: ${CONTOSO}`);
    expect(body).toContain('Email: alex.morgan@contoso.example');
    // Spaces are %20, not +, which mail clients would show literally
    expect(href).not.toContain('+');
  });

  it('labels the organisation by sign-in domain', () => {
    expect(organisationLabel('Sam.Taylor@Contoso.Example')).toBe('contoso.example');
    expect(organisationLabel(null)).toBeNull();
    expect(organisationLabel('no-at-sign')).toBeNull();
  });
});

describe('open paths', () => {
  it('lets an unapproved person sign in, sign out, install and see this page, and nothing else', () => {
    for (const path of [
      '/not-approved',
      '/login',
      '/install',
      '/api/auth/session',
      '/api/auth/signout',
      '/api/install/callback',
      '/api/email/poll',
      '/api/github/webhook',
    ]) {
      expect(isOpenPath(path), path).toBe(true);
    }
    for (const path of [
      '/',
      '/tickets',
      '/admin',
      '/api/devops/tickets',
      '/api/lightning',
      '/api/github/issues',
      '/not-approvedx',
      '/loginx',
    ]) {
      expect(isOpenPath(path), path).toBe(false);
    }
  });
});

describe('notApprovedView', () => {
  const unapproved = {
    tenantId: CONTOSO,
    tenantApproved: false,
    user: { email: 'alex.morgan@contoso.example' },
  };

  it('shows a signed-in, unapproved person their organisation and tenant', () => {
    expect(notApprovedView(unapproved, {})).toEqual({
      signedIn: true,
      installed: false,
      organisation: 'contoso.example',
      tenantId: CONTOSO,
      email: 'alex.morgan@contoso.example',
    });
  });

  it('shows a session with no tid as unapproved, with no tenant', () => {
    const view = notApprovedView({ tenantApproved: false, user: { email: null } }, {});
    expect(view).toMatchObject({ signedIn: true, tenantId: null });
  });

  it('sends an approved person to the app', () => {
    expect(notApprovedView({ ...unapproved, tenantApproved: true }, {})).toEqual({
      redirect: '/',
    });
  });

  it('shows "installed, pending approval" straight after the install flow', () => {
    expect(notApprovedView(null, { installed: '1', tenant: CONTOSO })).toEqual({
      signedIn: false,
      installed: true,
      organisation: null,
      tenantId: CONTOSO,
      email: null,
    });
  });

  it('sends anyone else to sign in, and never echoes a tenant that is not a GUID', () => {
    expect(notApprovedView(null, {})).toEqual({ redirect: '/login' });
    expect(notApprovedView(null, { installed: '1', tenant: '<script>' })).toEqual({
      redirect: '/login',
    });
  });
});
