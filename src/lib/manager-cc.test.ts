import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { managerEmailsFor, parseProjectManagers } from './manager-cc';

// An organisation's manager is copied on their people's ticket mail. The
// organisation is an Azure DevOps project, so the mapping is keyed by project.

const ENV_KEYS = ['PROJECT_MANAGER_EMAILS', 'MAIL_FROM', 'MAIL_POLL_MAILBOX'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe('parseProjectManagers', () => {
  it('reads one address per project', () => {
    expect(parseProjectManagers('{"Contoso Ltd":"manager@example.com"}')).toEqual({
      'contoso ltd': ['manager@example.com'],
    });
  });

  it('reads several, as an array or as one separated string', () => {
    expect(
      parseProjectManagers('{"ABC Inc":["a@example.com","b@example.com"]}')['abc inc']
    ).toEqual(['a@example.com', 'b@example.com']);
    expect(parseProjectManagers('{"ABC Inc":"a@example.com; b@example.com"}')['abc inc']).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  // One organisation's mistake must not stop another's mail.
  it('drops what it cannot use and keeps the rest', () => {
    const mapping = parseProjectManagers(
      '{"ABC Inc":["not-an-address","good@example.com"],"DEF Inc":[],"Contoso Ltd":"ok@example.com"}'
    );
    expect(mapping['abc inc']).toEqual(['good@example.com']);
    expect(mapping['def inc']).toBeUndefined();
    expect(mapping['contoso ltd']).toEqual(['ok@example.com']);
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty string', '   '],
    ['invalid JSON', '{not json'],
    ['a JSON array', '["manager@example.com"]'],
    ['a JSON string', '"manager@example.com"'],
  ])('returns no mapping for %s', (_label, raw) => {
    expect(parseProjectManagers(raw)).toEqual({});
  });
});

// These addresses come from configuration and go straight into `ccRecipients`,
// so an entry that means something else in a header would add a recipient
// nobody configured (raised in review on #656).
describe('addresses that could carry a second recipient', () => {
  it.each([
    ['angle brackets', '<a@b.com>'],
    ['a quoted local part', '"x"@y.com'],
    ['a colon', 'a:b@c.com'],
    ['brackets', 'a[1]@b.com'],
    ['a backslash', 'a\b@c.com'],
    ['parentheses', 'a(comment)@b.com'],
  ])('refuses %s', (_label, entry) => {
    expect(
      parseProjectManagers(`{"ABC Inc":[${JSON.stringify(entry)}]}`)['abc inc']
    ).toBeUndefined();
  });

  // A comma or semicolon is the documented way to give several, so it is
  // split into separate recipients rather than refused -- and each part still
  // has to be an address.
  it('splits a separated string instead of treating it as one address', () => {
    expect(parseProjectManagers('{"ABC Inc":"a@b.com, c@d.com"}')['abc inc']).toEqual([
      'a@b.com',
      'c@d.com',
    ]);
    expect(parseProjectManagers('{"ABC Inc":"a@b.com; <bad>"}')['abc inc']).toEqual(['a@b.com']);
  });

  it('still accepts the ordinary shapes', () => {
    expect(
      parseProjectManagers('{"ABC Inc":["a.b-c@sub.example.co.uk","ok@intranet"]}')['abc inc']
    ).toEqual(['a.b-c@sub.example.co.uk', 'ok@intranet']);
  });
});

describe('managerEmailsFor', () => {
  const config = '{"Contoso Ltd":"manager@example.com","ABC Inc":"boss@example.com"}';

  it('finds the manager for the project', () => {
    expect(managerEmailsFor('Contoso Ltd', 'alex@example.com', config)).toEqual([
      'manager@example.com',
    ]);
  });

  // The name arrives from a work item field, a route and a config file, and
  // those do not agree on capitalisation.
  it('does not care how the project name is capitalised', () => {
    expect(managerEmailsFor('  contoso LTD ', 'alex@example.com', config)).toEqual([
      'manager@example.com',
    ]);
  });

  it('copies nobody for a project with no manager, or no project', () => {
    expect(managerEmailsFor('DEF Inc', 'alex@example.com', config)).toEqual([]);
    expect(managerEmailsFor(undefined, 'alex@example.com', config)).toEqual([]);
    expect(managerEmailsFor('   ', 'alex@example.com', config)).toEqual([]);
  });

  // They would otherwise receive the same message twice.
  it('does not copy the person it is already being sent to', () => {
    expect(managerEmailsFor('Contoso Ltd', 'MANAGER@example.com', config)).toEqual([]);
  });

  it('does not copy the same address twice', () => {
    expect(
      managerEmailsFor(
        'ABC Inc',
        'alex@example.com',
        '{"ABC Inc":["x@example.com","X@example.com"]}'
      )
    ).toEqual(['x@example.com']);
  });

  // Mail to a ZapDesk mailbox is read straight back in as a comment, which
  // sends another.
  it('refuses the mailbox ZapDesk polls', () => {
    process.env.MAIL_POLL_MAILBOX = 'support@example.com';
    expect(
      managerEmailsFor('ABC Inc', 'alex@example.com', '{"ABC Inc":"support@example.com"}')
    ).toEqual([]);
  });

  it('refuses the address ZapDesk sends as', () => {
    process.env.MAIL_FROM = 'zapdesk@example.com';
    expect(
      managerEmailsFor('ABC Inc', 'alex@example.com', '{"ABC Inc":"zapdesk@example.com"}')
    ).toEqual([]);
  });

  // `constructor` and friends are on every object's prototype. Reading one
  // would hand back something that is not an array, and the loop would throw
  // where every caller swallows it -- so no mail at all (raised in review on
  // #656).
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'copies nobody for a project called %s',
    (project) => {
      expect(managerEmailsFor(project, 'alex@example.com', '{}')).toEqual([]);
      expect(managerEmailsFor(project, 'alex@example.com', undefined)).toEqual([]);
    }
  );

  it('reads the environment when no configuration is passed', () => {
    process.env.PROJECT_MANAGER_EMAILS = config;
    expect(managerEmailsFor('Contoso Ltd', 'alex@example.com')).toEqual(['manager@example.com']);
  });
});
