import { describe, it, expect } from 'vitest';
import {
  assertSafeWrite,
  commentHeader,
  descriptionHeader,
  devopsPriority,
  findZendeskImages,
  importTags,
  isEmailTag,
  planTicket,
  replaceImageSrc,
  type ImportConfig,
  type ZendeskTicket,
  type ZendeskUser,
} from './zendesk-import';

const CREATE = 'https://dev.azure.com/Contoso/ABC%20Inc/_apis/wit/workitems/$Task';
const UPDATE = 'https://dev.azure.com/Contoso/_apis/wit/workitems/42';
const QS = '?bypassRules=true&suppressNotifications=true&api-version=7.1';

const config: ImportConfig = {
  devopsOrg: 'Contoso',
  projects: { 'example.com': 'ABC Inc' },
  assignees: { 'Alex Morgan': 'Alex Morgan <alex.morgan@example.com>' },
  zendeskImageHosts: ['contoso.zendesk.com', 'support.example.test'],
};

const users = new Map<number, ZendeskUser>([
  [1, { id: 1, name: 'Sam Taylor', email: 'sam.taylor@example.com' }],
  [2, { id: 2, name: 'Alex Morgan', email: 'alex.morgan@example.com' }],
  [3, { id: 3, name: 'Jordan Lee', email: 'jordan@elsewhere.example' }],
]);

const ticket = (over: Partial<ZendeskTicket> = {}): ZendeskTicket => ({
  id: 7,
  subject: 'Printer offline',
  status: 'closed',
  priority: 'normal',
  requester_id: 1,
  assignee_id: 2,
  created_at: '2025-03-01T10:00:00Z',
  via: { channel: 'email' },
  ...over,
});

describe('assertSafeWrite: no write can email anyone', () => {
  it('lets a Task create with notifications suppressed through', () => {
    expect(() =>
      assertSafeWrite('POST', CREATE + QS, [
        { op: 'add', path: '/fields/System.Tags', value: 'zendesk-import; zendesk:7' },
      ])
    ).not.toThrow();
  });

  it('refuses a write that does not suppress notifications', () => {
    expect(() => assertSafeWrite('PATCH', UPDATE + '?api-version=7.1', [])).toThrow(
      /suppressNotifications/
    );
    expect(() => assertSafeWrite('PATCH', UPDATE + '?suppressNotifications=false', [])).toThrow(
      /suppressNotifications/
    );
  });

  it('refuses to create any other work item type, which may have service hooks', () => {
    const feature = CREATE.replace('$Task', '$Feature');
    expect(() => assertSafeWrite('POST', feature + QS, [])).toThrow(/only Task/);
  });

  it('refuses the email tags that make ZapDesk mail the requester', () => {
    for (const value of ['zendesk-import; email', 'Email', 'a; email-from:sam@example.com']) {
      expect(() =>
        assertSafeWrite('PATCH', UPDATE + QS, [{ op: 'add', path: '/fields/System.Tags', value }])
      ).toThrow(/email tag/);
    }
  });

  it('does not mistake a tag that only contains the word', () => {
    expect(isEmailTag('email-notification-failure')).toBe(false);
    expect(isEmailTag(' email ')).toBe(true);
  });
});

describe('importTags', () => {
  it('marks the ticket and never carries an email tag', () => {
    expect(importTags(46)).toEqual(['zendesk-import', 'zendesk:46']);
    expect(importTags(46).some(isEmailTag)).toBe(false);
  });
});

describe('devopsPriority', () => {
  it('maps Zendesk priorities and falls back to Normal', () => {
    expect(devopsPriority('urgent')).toBe(1);
    expect(devopsPriority('high')).toBe(2);
    expect(devopsPriority('normal')).toBe(3);
    expect(devopsPriority('low')).toBe(4);
    expect(devopsPriority(null)).toBe(3);
  });
});

describe('planTicket', () => {
  it('places a ticket by requester domain and maps assignee, state and priority', () => {
    expect(planTicket(ticket({ status: 'pending', priority: 'high' }), users, config)).toEqual({
      zendeskId: 7,
      project: 'ABC Inc',
      assignee: 'Alex Morgan <alex.morgan@example.com>',
      state: 'Pending',
      priority: 2,
      tags: ['zendesk-import', 'zendesk:7'],
      problems: [],
    });
  });

  it('closes a solved ticket, since the Task process has no Resolved', () => {
    expect(planTicket(ticket({ status: 'solved' }), users, config).state).toBe('Closed');
  });

  it('holds back a ticket from an unmapped domain', () => {
    const plan = planTicket(ticket({ requester_id: 3 }), users, config);
    expect(plan.project).toBeNull();
    expect(plan.problems).toEqual(['no project for requester domain "elsewhere.example"']);
  });

  it('holds back a ticket assigned to someone outside the subset', () => {
    const plan = planTicket(ticket({ assignee_id: 3 }), users, config);
    expect(plan.problems).toEqual(['assignee is not one of the configured assignees']);
  });

  it('holds back a status with no DevOps state', () => {
    expect(planTicket(ticket({ status: 'deleted' }), users, config).problems).toEqual([
      'no DevOps state for Zendesk status "deleted"',
    ]);
  });
});

describe('findZendeskImages and replaceImageSrc', () => {
  const pic = 'https://support.example.test/attachments/token/abc/?name=image.png&amp;x=1';
  const html =
    `<p>See</p><img src="${pic}" alt="image.png"><img src="${pic}">` +
    `<img src="https://cdn.elsewhere.example/logo.png"><img src="/relative.png">`;

  it('finds each Zendesk-hosted picture once, as written', () => {
    expect(findZendeskImages(html, config.zendeskImageHosts)).toEqual([pic]);
  });

  it('points every copy of the picture at the uploaded one', () => {
    const out = replaceImageSrc(
      html,
      pic,
      'https://dev.azure.com/Contoso/_apis/wit/attachments/1?fileName=a.png&b=2'
    );
    expect(out).not.toContain('support.example.test');
    expect(out.match(/attachments\/1\?fileName=a\.png&amp;b=2/g)).toHaveLength(2);
    expect(out).toContain('cdn.elsewhere.example');
  });
});

describe('headers', () => {
  it('names the requester and original date, escaped', () => {
    const header = descriptionHeader(ticket(), {
      id: 1,
      name: 'Sam <Taylor>',
      email: 'sam@example.com',
    });
    expect(header).toBe(
      '<p><em>Imported from Zendesk #7 &middot; requester Sam &lt;Taylor&gt; (sam@example.com)' +
        ' &middot; created 2025-03-01 10:00 UTC &middot; via email</em></p>'
    );
  });

  it('names the original author and whether it was internal', () => {
    const header = commentHeader(
      { id: 9, author_id: 2, public: false, created_at: '2025-03-02T08:30:00Z' },
      users.get(2)
    );
    expect(header).toBe(
      '<p><em>From Zendesk &middot; Alex Morgan &middot; 2025-03-02 08:30 UTC &middot; internal note</em></p>'
    );
  });
});
