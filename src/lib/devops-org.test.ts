import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MissingDevOpsOrgError,
  configuredDevOpsOrg,
  devOpsOrgOrDefault,
  requestDevOpsOrg,
} from './devops-org';
import { AzureDevOpsService, workItemToTicket } from './devops';

// No built-in Azure DevOps organization (#457): the selected one, else the
// server default, else a clear error -- never someone else's organization.

const request = (org?: string) =>
  new Request('https://zapdesk.test/api', { headers: org ? { 'x-devops-org': org } : {} });

describe('Azure DevOps organization', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers the organization the request names', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', 'server-default');
    expect(requestDevOpsOrg(request('acme'))).toBe('acme');
    expect(requestDevOpsOrg(request())).toBe('server-default');
  });

  it('has no default of its own', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', '  ');
    expect(configuredDevOpsOrg()).toBeNull();
    expect(requestDevOpsOrg(request())).toBeNull();
    expect(() => devOpsOrgOrDefault()).toThrow(MissingDevOpsOrgError);
  });

  it('refuses to build a DevOps service without an organization', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', '');
    expect(() => new AzureDevOpsService('token')).toThrow(MissingDevOpsOrgError);
    expect(new AzureDevOpsService('token', 'acme').organizationName).toBe('acme');
  });

  it('links a work item into its own organization', () => {
    vi.stubEnv('AZURE_DEVOPS_ORG', '');
    const workItem = {
      id: 7,
      fields: {
        'System.Title': 'Printer on fire',
        'System.State': 'New',
        'System.TeamProject': 'Help Desk',
        'System.CreatedDate': '2026-10-01T09:00:00Z',
        'System.ChangedDate': '2026-10-01T09:00:00Z',
        'System.CreatedBy': {
          id: 'u1',
          displayName: 'Dana Scully',
          uniqueName: 'dana@example.test',
        },
      },
    };
    const organization = {
      id: 'p1',
      name: 'Help Desk',
      devOpsProject: 'Help Desk',
      devOpsOrg: 'acme',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(workItemToTicket(workItem as never, organization).devOpsUrl).toBe(
      'https://dev.azure.com/acme/Help%20Desk/_workitems/edit/7'
    );
    expect(workItemToTicket(workItem as never).devOpsUrl).toBe('');
  });
});
