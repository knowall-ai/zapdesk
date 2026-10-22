import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ticketFieldsToRequest,
  CORE_TICKET_FIELDS,
  OPTIONAL_TICKET_FIELDS,
} from './work-item-fields';

describe('ticketFieldsToRequest', () => {
  it('asks for every field when the organization defines them all', () => {
    const all = new Set<string>([...CORE_TICKET_FIELDS, ...OPTIONAL_TICKET_FIELDS]);
    const fields = ticketFieldsToRequest(all);
    expect(fields).toEqual([...CORE_TICKET_FIELDS, ...OPTIONAL_TICKET_FIELDS]);
  });

  it('leaves out an optional field the organization does not define', () => {
    const all = new Set<string>([...CORE_TICKET_FIELDS, ...OPTIONAL_TICKET_FIELDS]);
    all.delete('Custom.CustomerResponse');

    const fields = ticketFieldsToRequest(all);

    // The real failure: KnowAll's custom field against any other organization.
    expect(fields).not.toContain('Custom.CustomerResponse');
    expect(fields).toContain('Microsoft.VSTS.Common.Priority');
    expect(fields).toContain('System.Title');
  });

  it('still asks for the core fields when nothing optional is defined', () => {
    const fields = ticketFieldsToRequest(new Set(CORE_TICKET_FIELDS));
    expect(fields).toEqual([...CORE_TICKET_FIELDS]);
  });

  it('asks for the core fields alone when discovery failed', () => {
    // null means "unknown", not "none": a list without the priority column is
    // worth having, an empty list is not.
    expect(ticketFieldsToRequest(null)).toEqual([...CORE_TICKET_FIELDS]);
  });

  it('never drops a core field, even if discovery somehow omits it', () => {
    const fields = ticketFieldsToRequest(new Set(['Custom.CustomerResponse']));
    for (const core of CORE_TICKET_FIELDS) {
      expect(fields).toContain(core);
    }
  });

  it('requests no field outside the two declared lists', () => {
    const declared = new Set<string>([...CORE_TICKET_FIELDS, ...OPTIONAL_TICKET_FIELDS]);
    const fields = ticketFieldsToRequest(declared);
    for (const field of fields) {
      expect(declared.has(field)).toBe(true);
    }
  });

  it('treats every core field as a System field, which all processes define', () => {
    // The split is only safe while the core list stays inside System.*, which
    // no process template can remove.
    for (const core of CORE_TICKET_FIELDS) {
      expect(core.startsWith('System.')).toBe(true);
    }
  });

  it('keeps the customised field out of the core list', () => {
    expect([...CORE_TICKET_FIELDS]).not.toContain('Custom.CustomerResponse');
    expect([...OPTIONAL_TICKET_FIELDS]).toContain('Custom.CustomerResponse');
  });

  it('returns no duplicates', () => {
    const all = new Set<string>([...CORE_TICKET_FIELDS, ...OPTIONAL_TICKET_FIELDS]);
    const fields = ticketFieldsToRequest(all);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('the ticket batch fetch does not name fields directly', () => {
  // The tests above cover the helper, but the bug was a literal field list
  // inside devops.ts. Re-adding one there would leave every test green while
  // the ticket list went empty again for any organization without the field,
  // so the source itself is checked.
  const source = readFileSync(join(__dirname, 'devops.ts'), 'utf8');

  it('mentions the customised field only to read it back, never to request it', () => {
    // Reading `fields['Custom.CustomerResponse']` off a returned work item is
    // right: it is simply undefined where the organization has no such field.
    // Listing it as a field to ASK for is what emptied the ticket list.
    const mentions = source.match(/Custom\.CustomerResponse/g) ?? [];
    const reads = source.match(/fields\['Custom\.CustomerResponse'\]/g) ?? [];
    expect(mentions).toHaveLength(reads.length);
  });

  it('builds the batch field list through the helper', () => {
    expect(source).toContain('ticketFieldsToRequest(await this.availableFieldNames())');
  });
});
