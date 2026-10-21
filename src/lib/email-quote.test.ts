/**
 * Customer replies keep only the new message, not the ZapDesk email they
 * quote (#7720). The HTML sample is the shape Graph returned for a Gmail
 * reply: the gmail_quote class is gone, leaving a bare blockquote after an
 * attribution line in the sender's language.
 */
import { describe, it, expect } from 'vitest';
import {
  renderEmailBody,
  renderEmailBodyHtml,
  stripQuotedHtml,
  stripQuotedText,
} from './email-clean';

const gmailReply = `<html><body><div>
<div>
<div dir=ltr>attachment test </div><br>
<div>
<div dir=ltr>, 14 . 2026.  18:45 Support Test &lt;<a href="mailto:support@zapdesk.test">support@zapdesk.test</a>&gt; :<br>
</div>
<blockquote style="margin:0 0 0 0.8ex;padding-left:1ex;border-left:1px solid #CCCCCC;">
<div><a href="https://zapdesk.example.test"><img src="https://zapdesk.example.test/email/zapdesk-logo.png" alt=ZapDesk></a></div>
<p>Hi Dana, </p>
<p>We've received your request and created ticket <strong>#7705</strong>. </p>
<p>Please reply to this email to update your ticket. </p>
</blockquote> </div>
<div><br></div><span>-- </span><br>
</div></body></html>`;

describe('stripQuotedHtml (#7720)', () => {
  it('keeps the new message and drops the quoted ZapDesk email and its attribution', () => {
    const out = stripQuotedHtml(gmailReply);
    expect(out).toContain('attachment test');
    expect(out).not.toContain('received your request');
    expect(out).not.toContain('blockquote');
    expect(out).not.toContain('support@zapdesk.test');
  });

  it('keeps a quote that is not ZapDesk mail', () => {
    const html =
      '<div>See what the supplier said:</div><blockquote>The part ships on Friday.</blockquote><div>Can you chase?</div>';
    expect(stripQuotedHtml(html)).toBe(html);
  });

  it('cuts an Outlook reply header block when it quotes ZapDesk', () => {
    const html =
      '<div>Thanks, that fixed it.</div><div id="divRplyFwdMsg"><b>From:</b> ZapDesk Support<br><b>Subject:</b> [ZapDesk #12] Printer</div><div>Old text</div>';
    const out = stripQuotedHtml(html);
    expect(out).toContain('that fixed it');
    expect(out).not.toContain('[ZapDesk #12]');
  });

  it('feeds the stored body: only the new message is kept', () => {
    const stored = renderEmailBodyHtml(gmailReply);
    expect(stored).toContain('attachment test');
    expect(stored).not.toContain('received your request');
  });
});

describe('stripQuotedText (#7720)', () => {
  it('drops an "On … wrote:" quote of a ZapDesk email', () => {
    const body = [
      'Any update on this?',
      '',
      'On Tue, 20 Oct 2026 at 08:18, ZapDesk Support <support@zapdesk.test> wrote:',
      '> We have received your request and created ticket #7735.',
      '> [ZapDesk #7735]',
    ].join('\n');
    expect(stripQuotedText(body)).toBe('Any update on this?');
    expect(renderEmailBody(body)).not.toContain('created ticket');
  });

  it('drops > lines with the attribution above them', () => {
    const body = 'Still broken.\nZapDesk Support wrote:\n> Your ticket #9 was updated\n> zapdesk';
    expect(stripQuotedText(body)).toBe('Still broken.');
  });

  it('keeps quoted text that is not ZapDesk mail', () => {
    const body = 'The error says:\n> Connection refused\nPlease help.';
    expect(stripQuotedText(body)).toBe(body);
  });
});

describe('one quote at a time (#7720 review)', () => {
  it('keeps an unrelated quote above a ZapDesk quote', () => {
    const html =
      '<div>The supplier said:</div><blockquote>The part ships on Friday.</blockquote>' +
      '<div>Any news?</div>' +
      '<div>On Tue, ZapDesk Support &lt;support@zapdesk.test&gt; wrote:</div>' +
      '<blockquote>Your ticket [ZapDesk #7735] was updated</blockquote>';
    const out = stripQuotedHtml(html);
    expect(out).toContain('The part ships on Friday.');
    expect(out).toContain('Any news?');
    expect(out).not.toContain('[ZapDesk #7735]');
    expect(out).not.toContain('wrote:');
  });

  it('keeps text written below a removed quote', () => {
    const html =
      '<div>On Tue, Support &lt;support@zapdesk.test&gt; wrote:</div><blockquote>zapdesk</blockquote><div>My answer is below the quote.</div>';
    expect(stripQuotedHtml(html)).toContain('My answer is below the quote.');
  });

  it('keeps an unrelated > quote above a ZapDesk one in plain text', () => {
    const body = [
      'The error says:',
      '> Connection refused',
      '',
      'Any news?',
      'On Tue, ZapDesk Support <support@zapdesk.test> wrote:',
      '> [ZapDesk #7735] update',
      '> zapdesk',
    ].join('\n');
    expect(stripQuotedText(body)).toBe('The error says:\n> Connection refused\n\nAny news?');
  });

  it('does not treat a plain "From:" line as a quote', () => {
    const body = 'From: the accounts team\nWe still have no invoice. zapdesk was mentioned.';
    expect(stripQuotedText(body)).toBe(body);
  });
});

describe('Outlook quotes are judged on their header fields (#7720 review)', () => {
  it('keeps a supplier quote whose body mentions ZapDesk (text)', () => {
    const body = [
      'Forwarding this.',
      '-----Original Message-----',
      'From: supplier@example.test',
      'Subject: Delivery',
      '',
      'Please log this in your ZapDesk.',
    ].join('\n');
    expect(stripQuotedText(body)).toBe(body);
  });

  it('cuts an Outlook quote whose header is ZapDesk (text)', () => {
    const body = [
      'Thanks.',
      '-----Original Message-----',
      'From: ZapDesk Support',
      'Subject: [ZapDesk #12] Printer',
      '',
      'Old text',
    ].join('\n');
    expect(stripQuotedText(body)).toBe('Thanks.');
  });

  it('keeps a supplier quote whose body mentions ZapDesk (HTML)', () => {
    const html =
      '<div>Forwarding this.</div><div id="divRplyFwdMsg"><b>From:</b> supplier@example.test<br><b>Subject:</b> Delivery</div><div>Please log this in your ZapDesk.</div>';
    expect(stripQuotedHtml(html)).toContain('Please log this in your ZapDesk.');
  });
});

describe('nested quotes (#7720 review)', () => {
  it('removes a ZapDesk quote inside an unrelated one, keeping the outer text', () => {
    const html =
      '<div>See below.</div><blockquote>The supplier wrote this.' +
      '<blockquote>[ZapDesk #7735] Your ticket was updated</blockquote></blockquote>';
    const out = stripQuotedHtml(html);
    expect(out).toContain('The supplier wrote this.');
    expect(out).not.toContain('[ZapDesk #7735]');
  });

  it('removes a ZapDesk quote whole even when it quotes something else inside', () => {
    const html =
      '<div>Any update?</div><div>Support &lt;support@zapdesk.test&gt; wrote:</div>' +
      '<blockquote>ZapDesk: your ticket was updated.' +
      '<blockquote>The customer quoted their supplier here.</blockquote></blockquote>';
    const out = stripQuotedHtml(html);
    expect(out).toContain('Any update?');
    expect(out).not.toContain('your ticket was updated');
    expect(out).not.toContain('quoted their supplier');
    expect(out).not.toContain('data-zapdesk-kept');
  });
});
