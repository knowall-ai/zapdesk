import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supportTeamRecipients } from './support-team';

/**
 * Who hears about a new ticket (#485, #7369).
 *
 * The two exclusions are the whole point of the function: the polled mailbox
 * because notifying it loops, and the person who caused the event because
 * telling them about their own action is noise.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support@example.test; sm@example.test';
  process.env.MAIL_POLL_MAILBOX = 'inbox@example.test';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('supportTeamRecipients', () => {
  it('returns everyone configured when nothing is excluded', () => {
    expect(supportTeamRecipients([])).toEqual(['support@example.test', 'sm@example.test']);
  });

  it('accepts a comma-separated list as well as a semicolon-separated one', () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'a@example.test,b@example.test';
    expect(supportTeamRecipients([])).toEqual(['a@example.test', 'b@example.test']);
  });

  it('returns nothing when the variable is unset', () => {
    delete process.env.SUPPORT_TEAM_NOTIFY_EMAIL;
    expect(supportTeamRecipients([])).toEqual([]);
  });

  // The loop: a notification sent to the polled mailbox is read back in as a
  // customer message, which notifies again.
  it('never includes the mailbox ZapDesk polls', () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'inbox@example.test; sm@example.test';
    expect(supportTeamRecipients([])).toEqual(['sm@example.test']);
  });

  it('matches the polled mailbox whatever case it is configured in', () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'INBOX@Example.TEST; sm@example.test';
    expect(supportTeamRecipients([])).toEqual(['sm@example.test']);
  });

  it('keeps everyone when no mailbox is polled', () => {
    delete process.env.MAIL_POLL_MAILBOX;
    expect(supportTeamRecipients([])).toHaveLength(2);
  });

  it('leaves out whoever caused the event', () => {
    expect(supportTeamRecipients(['sm@example.test'])).toEqual(['support@example.test']);
  });

  it('matches an excluded address whatever case it arrives in', () => {
    // Azure AD returns the address a person signed up with, which is not
    // necessarily how it was typed into the environment variable.
    expect(supportTeamRecipients(['SM@Example.TEST'])).toEqual(['support@example.test']);
  });

  it('ignores a null or undefined exclusion rather than dropping anyone', () => {
    // An unassigned ticket, or a session with no email on it.
    expect(supportTeamRecipients([null, undefined])).toHaveLength(2);
  });

  it('can exclude several people at once', () => {
    expect(supportTeamRecipients(['sm@example.test', 'support@example.test'])).toEqual([]);
  });

  it('tolerates surrounding whitespace on both sides of the comparison', () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = '  sm@example.test  ';
    expect(supportTeamRecipients([' sm@example.test '])).toEqual([]);
  });
});
