import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  customerNotifyStates,
  notifiesCustomer,
  statusChangeRecipient,
} from './status-notification';

// A status change told the customer nothing unless the ticket had arrived by
// email, because the only recipient it knew how to find was a tag the mailbox
// ingest writes (#654).

const ENV_KEYS = ['CUSTOMER_NOTIFY_STATES', 'MAIL_FROM', 'MAIL_POLL_MAILBOX'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('which states reach the customer', () => {
  it.each(['Todo', 'Active', 'Resolved', 'Closed'])('tells them about %s', (state) => {
    expect(notifiesCustomer(state)).toBe(true);
  });

  // Internal on purpose: a customer told their ticket is Blocked, or was
  // Removed, rings up about it.
  it.each(['New', 'Blocked', 'Pending', 'Removed'])('keeps %s internal', (state) => {
    expect(notifiesCustomer(state)).toBe(false);
  });

  it('does not care about case or stray spacing', () => {
    expect(notifiesCustomer('  rESOLVED ')).toBe(true);
  });

  it('is unmoved by a state it has never heard of', () => {
    expect(notifiesCustomer('Awaiting Parts')).toBe(false);
  });

  it('can be told a different vocabulary', () => {
    process.env.CUSTOMER_NOTIFY_STATES = 'In Progress, Done';
    expect(notifiesCustomer('In Progress')).toBe(true);
    expect(notifiesCustomer('Done')).toBe(true);
    // The override replaces the defaults rather than adding to them.
    expect(notifiesCustomer('Active')).toBe(false);
  });

  // An empty value is a misconfiguration, not an instruction to go quiet.
  it('ignores a blank override instead of silencing everything', () => {
    process.env.CUSTOMER_NOTIFY_STATES = '   ,  ';
    expect(notifiesCustomer('Active')).toBe(true);
    expect(customerNotifyStates().size).toBeGreaterThan(0);
  });
});

describe('who gets told', () => {
  const createdBy = (uniqueName: string) => ({ 'System.CreatedBy': { uniqueName } });

  it('prefers the address the ingest recorded', () => {
    expect(
      statusChangeRecipient({
        'System.Tags': 'ticket; email; email-from:alex@example.com',
        ...createdBy('service-account@example.com'),
      })
    ).toBe('alex@example.com');
  });

  // The case this issue is about: no tags at all.
  it('falls back to whoever created the ticket', () => {
    expect(statusChangeRecipient(createdBy('sam@example.com'))).toBe('sam@example.com');
  });

  it('reads a creator given as a bare string', () => {
    expect(statusChangeRecipient({ 'System.CreatedBy': 'sam@example.com' })).toBe(
      'sam@example.com'
    );
  });

  it('falls back when the tag holds something that is not an address', () => {
    expect(
      statusChangeRecipient({
        'System.Tags': 'email; email-from:not-an-address',
        ...createdBy('sam@example.com'),
      })
    ).toBe('sam@example.com');
  });

  it('has nobody to tell when neither is an address', () => {
    expect(statusChangeRecipient(createdBy('Build Service'))).toBeNull();
    expect(statusChangeRecipient({})).toBeNull();
    expect(statusChangeRecipient(undefined)).toBeNull();
  });

  // Mail to either is read straight back in and becomes a comment on the
  // ticket that produced it, which sends another.
  it('refuses the mailbox ZapDesk polls', () => {
    process.env.MAIL_POLL_MAILBOX = 'support@example.com';
    expect(statusChangeRecipient(createdBy('support@example.com'))).toBeNull();
  });

  it('refuses the address ZapDesk sends as', () => {
    process.env.MAIL_FROM = 'zapdesk@example.com';
    expect(statusChangeRecipient(createdBy('zapdesk@example.com'))).toBeNull();
  });

  it('still falls back to the creator when the tagged address is the polled mailbox', () => {
    process.env.MAIL_POLL_MAILBOX = 'support@example.com';
    expect(
      statusChangeRecipient({
        'System.Tags': 'email; email-from:support@example.com',
        ...createdBy('sam@example.com'),
      })
    ).toBe('sam@example.com');
  });
});
