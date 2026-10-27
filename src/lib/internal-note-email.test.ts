import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * What actually goes out in the internal-note email (7767).
 *
 * The note is written in the browser's editor, but it reaches this path
 * straight from the request body -- so the client-side sanitiser is not in
 * front of it, and an agent account posting directly can put any markup into
 * mail the support team receives.
 */

const sendMailBodies: string[] = [];

function stubMailEnv() {
  vi.stubEnv('MAIL_FROM', 'support@example.test');
  vi.stubEnv('MAIL_CLIENT_ID', 'client');
  vi.stubEnv('MAIL_CLIENT_SECRET', 'secret');
  vi.stubEnv('MAIL_TENANT_ID', 'tenant');
}

beforeEach(() => {
  sendMailBodies.length = 0;
  stubMailEnv();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/sendMail')) {
        sendMailBodies.push(String(init?.body ?? ''));
        return new Response('', { status: 202 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function sentHtml(noteHtml: string): Promise<string> {
  const { sendInternalNoteNotification } = await import('./email');
  await sendInternalNoteNotification({
    ticketId: 7,
    ticketSubject: 'Printer offline',
    authorName: 'Dana Shaw',
    noteHtml,
    recipients: 'team@example.test',
  });
  expect(sendMailBodies).toHaveLength(1);
  return (JSON.parse(sendMailBodies[0]) as { message: { body: { content: string } } }).message.body
    .content;
}

describe('sendInternalNoteNotification', () => {
  it('sanitises the note before it is emailed', async () => {
    const html = await sentHtml('<p>Handover<script>alert(1)</script></p>');

    expect(html).toContain('Handover');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips an event handler without stripping the note', async () => {
    const html = await sentHtml('<p onclick="alert(1)">Call the supplier first.</p>');

    expect(html).toContain('Call the supplier first.');
    expect(html).not.toContain('onclick');
  });

  it('keeps the ordinary markup a note is written in', async () => {
    // Sanitising is not an excuse to send plain text: a note loses its
    // meaning when the emphasis and the links go with the markup.
    const html = await sentHtml(
      '<p><strong>Do not</strong> refund yet -- see <a href="https://example.test/policy">policy</a>.</p>'
    );

    expect(html).toContain('<strong>Do not</strong>');
    expect(html).toContain('href="https://example.test/policy"');
  });

  it('does not invite a reply that would reach the customer', async () => {
    // A reply to this email is ingested as an ordinary *public* comment, so
    // the footer's standard invitation would hand the customer the one note
    // written to be kept from them.
    const html = await sentHtml('<p>Handover.</p>');

    expect(html).not.toContain('Please reply to this email');
    expect(html).toContain('Reply on the ticket, not to this email.');
  });
});
