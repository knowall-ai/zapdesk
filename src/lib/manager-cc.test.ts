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

  it('reads the environment when no configuration is passed', () => {
    process.env.PROJECT_MANAGER_EMAILS = config;
    expect(managerEmailsFor('Contoso Ltd', 'alex@example.com')).toEqual(['manager@example.com']);
  });
});
