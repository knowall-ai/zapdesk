import { describe, it, expect } from 'vitest';
import { customerDomain } from './customer-domain';

describe('customerDomain', () => {
  it('groups contacts at the same company together', () => {
    expect(customerDomain('ada@acme.com')).toBe('acme.com');
    expect(customerDomain('grace@acme.com')).toBe('acme.com');
  });

  it('keeps a subdomain, which can be a different customer', () => {
    expect(customerDomain('ada@support.acme.co.uk')).toBe('support.acme.co.uk');
  });

  it('is case and whitespace insensitive, so one company is one entry', () => {
    expect(customerDomain('  Ada@ACME.com ')).toBe('acme.com');
  });

  // An address may legitimately contain an @ in a quoted local part.
  it('reads the last @, not the first', () => {
    expect(customerDomain('"odd@name"@acme.com')).toBe('acme.com');
  });

  it('has no answer when there is no address to read', () => {
    for (const value of [undefined, '', '   ', 'not-an-address', '@acme.com', 'ada@']) {
      expect(customerDomain(value)).toBeUndefined();
    }
  });

  it('rejects a dotless host rather than inventing a customer', () => {
    expect(customerDomain('ada@localhost')).toBeUndefined();
  });

  it('ignores a trailing dot, which is valid DNS but not a separate customer', () => {
    expect(customerDomain('ada@acme.com.')).toBe('acme.com');
  });

  // The reason the filter is by domain and not by name (#7385): a monthly
  // checkpoint covers a company, and a company has several people.
  it('collapses several contacts at one company into one customer', () => {
    const requesters = ['ada@acme.com', 'grace@acme.com', 'alan@other.test', undefined];
    const options = [...new Set(requesters.map(customerDomain).filter(Boolean))].sort();

    expect(options).toEqual(['acme.com', 'other.test']);

    const selected = ['acme.com'];
    const matched = requesters.filter((r) => {
      const d = customerDomain(r);
      return d !== undefined && selected.includes(d);
    });
    expect(matched).toEqual(['ada@acme.com', 'grace@acme.com']);
  });
});
