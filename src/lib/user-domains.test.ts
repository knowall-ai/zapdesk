import { describe, it, expect } from 'vitest';
import { domainOf, emailDomainsOf, matchesDomain } from './user-domains';

/**
 * The Users page's domain filter (#159). The feature was already built; what
 * was missing was agreement about case between the dropdown and the matching.
 */

const user = (email: string) => ({ email });

describe('emailDomainsOf', () => {
  it('offers one option per company, however the addresses were typed', () => {
    // The shape Azure DevOps actually returns: whatever each person signed up
    // with. Two options for one company is the bug.
    const domains = emailDomainsOf([
      user('Ben@KnowAll.AI'),
      user('sam@knowall.ai'),
      user('Edi@KNOWALL.AI'),
    ]);

    expect(domains).toEqual(['knowall.ai']);
  });

  it('sorts the options so the dropdown is stable', () => {
    expect(emailDomainsOf([user('a@zeta.test'), user('b@alpha.test')])).toEqual([
      'alpha.test',
      'zeta.test',
    ]);
  });

  it('leaves out anything with no domain to file it under', () => {
    expect(emailDomainsOf([user(''), user('nobody'), user('trailing@')])).toEqual([]);
  });

  it('keeps distinct companies apart', () => {
    expect(emailDomainsOf([user('a@one.test'), user('b@two.test')])).toEqual([
      'one.test',
      'two.test',
    ]);
  });
});

describe('matchesDomain', () => {
  it('matches an address whose case differs from the option', () => {
    // The half that actually hid people: the option is lower-cased, so a
    // comparison against the raw address missed everyone who typed it oddly.
    expect(matchesDomain('Ben@KnowAll.AI', 'knowall.ai')).toBe(true);
  });

  it('matches the plain case too', () => {
    expect(matchesDomain('sam@knowall.ai', 'knowall.ai')).toBe(true);
  });

  it('lets everything through when no domain is chosen', () => {
    expect(matchesDomain('anyone@anywhere.test', 'all')).toBe(true);
  });

  it('does not match a different domain', () => {
    expect(matchesDomain('sam@knowall.ai', 'contoso.test')).toBe(false);
  });

  // endsWith('@' + domain) was the old test, and 'evilknowall.ai' does not end
  // with '@knowall.ai', so this was never wrong -- but comparing the whole
  // domain says so outright rather than relying on the '@'.
  it('does not match a domain that merely ends the same way', () => {
    expect(matchesDomain('sam@notknowall.ai', 'knowall.ai')).toBe(false);
  });

  it('does not match a domain that merely starts the same way', () => {
    expect(matchesDomain('sam@knowall.ai.evil.test', 'knowall.ai')).toBe(false);
  });

  it('matches whatever case the option itself arrives in', () => {
    expect(matchesDomain('sam@knowall.ai', 'KnowAll.AI')).toBe(true);
  });
});

describe('domainOf', () => {
  it('takes the part after the last @, since local parts may contain one', () => {
    expect(domainOf('odd@name@knowall.ai')).toBe('knowall.ai');
  });

  it('gives nothing for an address with no domain', () => {
    expect(domainOf('nobody')).toBe('');
    expect(domainOf('trailing@')).toBe('');
    expect(domainOf('')).toBe('');
    expect(domainOf(null)).toBe('');
    expect(domainOf(undefined)).toBe('');
  });
});

// The two halves have to agree, or an option appears that matches nobody.
describe('the dropdown and the filter agree', () => {
  it('every option it offers matches at least the user it came from', () => {
    const users = [
      user('Ben@KnowAll.AI'),
      user('sam@knowall.ai'),
      user('ops@Contoso.TEST'),
      user('nobody'),
    ];

    for (const domain of emailDomainsOf(users)) {
      expect(
        users.some((u) => matchesDomain(u.email, domain)),
        `the option "${domain}" matches nobody in the list`
      ).toBe(true);
    }
  });

  it('every user with a domain is reachable through exactly one option', () => {
    const users = [user('Ben@KnowAll.AI'), user('sam@knowall.ai'), user('ops@Contoso.TEST')];
    const options = emailDomainsOf(users);

    for (const u of users) {
      const matching = options.filter((d) => matchesDomain(u.email, d));
      expect(matching, `${u.email} is reachable through ${matching.length} options`).toHaveLength(
        1
      );
    }
  });
});
