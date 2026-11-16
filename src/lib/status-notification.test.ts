import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  customerNotifyStates,
  notifiesCustomer,
  stateMoved,
  statusChangeRecipient,
} from './status-notification';

// The customer of an emailed ticket hears about a real state change into a
// state worth telling them about -- and nobody else, and nothing else.

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

  it('tells the customer of a ticket that arrived by email', () => {
    expect(
      statusChangeRecipient({
        'System.Tags': 'ticket; email; email-from:alex@example.com',
        ...createdBy('service-account@example.com'),
      })
    ).toBe('alex@example.com');
  });

  // #654 mailed the creator of every ticket, usually a colleague. Only the
  // customer who wrote in is told now.
  it('tells nobody about a ticket that did not arrive by email', () => {
    expect(statusChangeRecipient(createdBy('sam@example.com'))).toBeNull();
    expect(statusChangeRecipient({ 'System.CreatedBy': 'sam@example.com' })).toBeNull();
    expect(
      statusChangeRecipient({ 'System.Tags': 'ticket', ...createdBy('sam@example.com') })
    ).toBeNull();
  });

  it('needs the email tag, not only an email-from tag', () => {
    expect(statusChangeRecipient({ 'System.Tags': 'ticket; email-from:alex@example.com' })).toBe(
      null
    );
  });

  it('does not fall back to the creator when the tag is not an address', () => {
    expect(
      statusChangeRecipient({
        'System.Tags': 'email; email-from:not-an-address',
        ...createdBy('sam@example.com'),
      })
    ).toBeNull();
  });

  it('has nobody to tell when there is nothing to read', () => {
    expect(statusChangeRecipient({})).toBeNull();
    expect(statusChangeRecipient(undefined)).toBeNull();
  });

  // Mail to either is read straight back in and becomes a comment on the
  // ticket that produced it, which sends another.
  it('refuses the mailbox ZapDesk polls, without falling back to the creator', () => {
    process.env.MAIL_POLL_MAILBOX = 'support@example.com';
    expect(
      statusChangeRecipient({
        'System.Tags': 'email; email-from:support@example.com',
        ...createdBy('sam@example.com'),
      })
    ).toBeNull();
  });

  it('refuses the address ZapDesk sends as', () => {
    process.env.MAIL_FROM = 'zapdesk@example.com';
    expect(statusChangeRecipient({ 'System.Tags': 'email; email-from:zapdesk@example.com' })).toBe(
      null
    );
  });
});

describe('whether the state moved', () => {
  it('is a move from one state to another', () => {
    expect(stateMoved('New', 'Active')).toBe(true);
    expect(stateMoved('Active', 'Resolved')).toBe(true);
  });

  it('is not a move to the state it was already in', () => {
    expect(stateMoved('Active', 'Active')).toBe(false);
  });

  it('ignores case and stray spacing', () => {
    expect(stateMoved(' active', 'Active ')).toBe(false);
  });

  // A mail saying "Unknown -> Resolved" is a guess sent to a customer.
  it('is not a move when the state before is unknown', () => {
    expect(stateMoved(undefined, 'Resolved')).toBe(false);
    expect(stateMoved('', 'Resolved')).toBe(false);
    expect(stateMoved('  ', 'Resolved')).toBe(false);
  });
});
