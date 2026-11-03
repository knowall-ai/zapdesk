import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ticketFieldsToRequest,
  boardFieldsToRequest,
  CORE_TICKET_FIELDS,
  OPTIONAL_TICKET_FIELDS,
  CORE_BOARD_FIELDS,
  OPTIONAL_BOARD_FIELDS,
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

  // The Kanban board's batch had the same literal list, naming three fields
  // outside System.* unconditionally -- two of which this module already
  // declares unsafe. A 400 there loses the whole board (#6713 review).
  it('builds the board field list through the helper too', () => {
    expect(source).toContain('boardFieldsToRequest(await this.availableFieldNames())');
  });

  // A new literal list inside a request URL is how this class of bug returns:
  // every test stays green while the board or the ticket list empties for an
  // organisation without the field. Both batch reads must take their fields
  // from a helper, never from an array written at the call site.
  it('builds no request field list inline', () => {
    expect(source).not.toMatch(/&fields=\$\{\[/);
    const batchReads = source.match(/&fields=\$\{fields\}/g) ?? [];
    expect(batchReads.length).toBe(2);
  });

  // WIQL validates its SELECT list as well, with 400 TF51005. The standup
  // queries are read for their ids alone, so they select nothing else.
  it('selects only the id in the standup WIQL', () => {
    expect(source).toContain("const fields = 'System.Id';");
  });
});

describe('boardFieldsToRequest', () => {
  it('asks for every field when the organisation defines them all', () => {
    const all = new Set<string>([...CORE_BOARD_FIELDS, ...OPTIONAL_BOARD_FIELDS]);
    expect(boardFieldsToRequest(all)).toEqual([...CORE_BOARD_FIELDS, ...OPTIONAL_BOARD_FIELDS]);
  });

  // The case that would take the board down: the closed-date field is left out
  // rather than named, and `closedDateOf` then falls back to ChangedDate.
  it('leaves out the closed date when the organisation does not define it', () => {
    const fields = boardFieldsToRequest(new Set(CORE_BOARD_FIELDS));
    expect(fields).not.toContain('Microsoft.VSTS.Common.ClosedDate');
    expect(fields).toEqual([...CORE_BOARD_FIELDS]);
  });

  it('asks for the core fields alone when discovery failed', () => {
    expect(boardFieldsToRequest(null)).toEqual([...CORE_BOARD_FIELDS]);
  });

  it('treats every core board field as a System field', () => {
    for (const core of CORE_BOARD_FIELDS) {
      expect(core.startsWith('System.')).toBe(true);
    }
  });

  // The board needs the iteration path for the sprint filter; the ticket list
  // does not ask for it. If this ever moved to the shared list the sprint
  // filter would quietly stop narrowing.
  it('keeps the iteration path the sprint filter needs', () => {
    expect(boardFieldsToRequest(new Set(CORE_BOARD_FIELDS))).toContain('System.IterationPath');
  });

  it('returns no duplicates', () => {
    const all = new Set<string>([...CORE_BOARD_FIELDS, ...OPTIONAL_BOARD_FIELDS]);
    const fields = boardFieldsToRequest(all);
    expect(new Set(fields).size).toBe(fields.length);
  });
});
