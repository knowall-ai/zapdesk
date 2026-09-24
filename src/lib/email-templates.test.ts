import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  customerReplyNotificationTemplate,
  ticketConfirmationTemplate,
  statusChangeTemplate,
} from './email-templates';

/**
 * `email-templates.ts` reads its logo URLs at module load, so each case has to
 * set the environment and then import the module fresh. Asserting against a
 * single top-level import would have made these tests depend on whatever the
 * runner inherited.
 */
async function loadWrapper(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  const mod = await import('./email-templates');
  return mod.layoutWrapper('<p>body</p>');
}

// Everything these templates render is attacker-reachable: the subject, the
// requester name and the from-address all arrive on an inbound email that
// anyone can send. Raw interpolation put that markup into mail delivered to an
// agent, and back to the customer.
const PAYLOAD = '<img src=x onerror="alert(1)">';

describe('customerReplyNotificationTemplate', () => {
  it('escapes the subject and the customer address', () => {
    const html = customerReplyNotificationTemplate({
      ticketId: 42,
      ticketSubject: PAYLOAD,
      customerEmail: `sender-address${PAYLOAD}`,
      replyContentHtml: '<p>hello</p>',
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('leaves the reply body HTML intact — renderEmailBody already made it safe', () => {
    const html = customerReplyNotificationTemplate({
      ticketId: 42,
      ticketSubject: 'Printer is on fire',
      customerEmail: 'sender-address',
      replyContentHtml: '<p>Still <strong>smoking</strong></p>',
    });

    expect(html).toContain('<p>Still <strong>smoking</strong></p>');
  });
});

describe('the customer-facing templates', () => {
  it('escapes the subject and requester name on the confirmation', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: PAYLOAD,
      requesterName: PAYLOAD,
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;img');
  });

  it('escapes the subject, requester name and both status names', () => {
    const html = statusChangeTemplate({
      ticketId: 7,
      subject: PAYLOAD,
      requesterName: PAYLOAD,
      oldStatus: PAYLOAD,
      newStatus: 'Active',
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('Active');
  });

  it('renders ordinary values unchanged apart from the escaping', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: 'Cannot log in',
      requesterName: 'Jane Doe',
    });

    expect(html).toContain('Cannot log in');
    expect(html).toContain('Hi Jane Doe,');
  });

  it('escapes an apostrophe in a name rather than dropping it', () => {
    const html = ticketConfirmationTemplate({
      ticketId: 7,
      subject: 'Access',
      requesterName: "Ciara O'Neill",
    });

    expect(html).toContain('Ciara O&#39;Neill');
  });
});

describe('layoutWrapper footer', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('always credits KnowAll AI in text', async () => {
    const html = await loadWrapper({ KNOWALL_LOGO_URL: undefined });
    expect(html).toContain('Powered by');
    expect(html).toContain('KnowAll AI');
    expect(html).toContain('https://knowall.ai');
  });

  it('renders no KnowAll image when no logo URL is configured', async () => {
    // Emitting an <img> anyway put a blank 120x30 gap into every outbound
    // customer email, or a broken-image icon when the asset 404s.
    const html = await loadWrapper({ KNOWALL_LOGO_URL: undefined });
    expect(html).not.toContain('alt="KnowAll AI"');
    expect(html).not.toContain('src=""');
  });

  it('renders the KnowAll image once a logo URL is configured', async () => {
    const logo = 'https://cdn.example.com/knowall.png';
    const html = await loadWrapper({ KNOWALL_LOGO_URL: logo });
    expect(html).toContain(`src="${logo}"`);
    expect(html).toContain('alt="KnowAll AI"');
  });

  it('uses the configured ZapDesk logo URL', async () => {
    const logo = 'https://cdn.example.com/zapdesk.png';
    const html = await loadWrapper({ ZAPDESK_LOGO_URL: logo, KNOWALL_LOGO_URL: undefined });
    expect(html).toContain(`src="${logo}"`);
  });

  it('falls back to an app-relative ZapDesk logo path', async () => {
    const html = await loadWrapper({
      ZAPDESK_LOGO_URL: undefined,
      APP_URL: 'https://zapdesk.test',
      KNOWALL_LOGO_URL: undefined,
    });
    expect(html).toContain('https://zapdesk.test/email/zapdesk-logo.png');
  });

  it('wraps the content it was given in a complete document', async () => {
    const html = await loadWrapper({ KNOWALL_LOGO_URL: undefined });
    expect(html).toContain('<p>body</p>');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });
});
