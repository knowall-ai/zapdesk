// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import NotApprovedHero from './NotApprovedHero';

// The "not set up yet" page: a headline, two ways to get in touch, the
// signed-in organisation, a way out, and nothing from the app.

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));

const TENANT = '11111111-2222-4333-8444-555555555555';

describe('NotApprovedHero', () => {
  afterEach(cleanup);

  it('offers a pre-filled request and a plain email address, side by side', () => {
    render(
      <NotApprovedHero
        signedIn
        installed={false}
        organisation="contoso.example"
        tenantId={TENANT}
        email="alex.morgan@contoso.example"
      />
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "Your organisation isn't set up on ZapDesk yet.",
      })
    ).toBeTruthy();

    const request = screen.getByRole('link', { name: 'Request access' });
    const href = request.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:hello@knowall.ai?subject=ZapDesk%20access%20request')).toBe(
      true
    );
    expect(decodeURIComponent(href)).toContain(`Tenant ID: ${TENANT}`);
    expect(decodeURIComponent(href)).toContain('Email: alex.morgan@contoso.example');

    const plain = screen.getByRole('link', { name: 'hello@knowall.ai' });
    expect(plain.getAttribute('href')).toBe('mailto:hello@knowall.ai');

    expect(screen.getByText('contoso.example')).toBeTruthy();
    expect(screen.getByText(TENANT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('has no navigation into the app', () => {
    const { container } = render(
      <NotApprovedHero
        signedIn
        installed={false}
        organisation={null}
        tenantId={null}
        email={null}
      />
    );
    expect(container.querySelector('nav')).toBeNull();
    const internal = [...container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => !href.startsWith('mailto:'));
    expect(internal).toEqual([]);
  });

  it('tells an admin straight from the install flow that approval is pending', () => {
    render(
      <NotApprovedHero
        signedIn={false}
        installed
        organisation={null}
        tenantId={TENANT}
        email={null}
      />
    );
    expect(screen.getByText('Installed, pending approval')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/login'
    );
  });
});
