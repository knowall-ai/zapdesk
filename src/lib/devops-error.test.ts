import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeUpdateFailure, devOpsErrorDetail, updateFailureStatus } from './devops-error';
import { AzureDevOpsService, DevOpsApiError } from './devops';

/**
 * Every refused work item update used to reach the user as one "Failed to
 * update" pop-up (#531). These pin that each cause now reads differently, and
 * that nothing raw from DevOps or a proxy leaks through.
 */

const ruleError = JSON.stringify({
  $id: '1',
  innerException: null,
  message:
    'TF401320: Rule Error for field Severity. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.',
  typeName: 'Microsoft.TeamFoundation.WorkItemTracking.Server.RuleValidationException',
  typeKey: 'RuleValidationException',
  errorCode: 0,
  eventId: 3200,
});

describe('devOpsErrorDetail', () => {
  it('takes the message out of a DevOps error body', () => {
    expect(devOpsErrorDetail(ruleError)).toBe(
      'TF401320: Rule Error for field Severity. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.'
    );
  });

  it('drops markup, which carries no reason and can echo infrastructure', () => {
    expect(devOpsErrorDetail('<html><body>502 Bad Gateway</body></html>')).toBeNull();
  });

  it('keeps short plain text, flattened', () => {
    expect(devOpsErrorDetail('  Service\n  unavailable  ')).toBe('Service unavailable');
  });

  it('returns nothing for an empty body or JSON without a message', () => {
    expect(devOpsErrorDetail('')).toBeNull();
    expect(devOpsErrorDetail(null)).toBeNull();
    expect(devOpsErrorDetail('{"typeKey":"X"}')).toBeNull();
    expect(devOpsErrorDetail('{"message":"   "}')).toBeNull();
    expect(devOpsErrorDetail('{"message":42}')).toBeNull();
  });

  it('caps a long reason', () => {
    const detail = devOpsErrorDetail(JSON.stringify({ message: 'x'.repeat(1000) }));
    expect(detail).not.toBeNull();
    expect(detail!.length).toBeLessThanOrEqual(300);
    expect(detail!.endsWith('…')).toBe(true);
  });
});

describe('describeUpdateFailure', () => {
  it("keeps DevOps's own words for a rule violation, which name the field", () => {
    expect(describeUpdateFailure(400, devOpsErrorDetail(ruleError))).toBe(
      'Azure DevOps rejected the change: TF401320: Rule Error for field Severity. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.'
    );
    expect(describeUpdateFailure(400, null)).toBe('Azure DevOps rejected the change (400).');
  });

  it('names an expired session, the cause the user can fix by reloading', () => {
    expect(describeUpdateFailure(401, 'anything')).toBe(
      'Your Azure DevOps session has expired. Reload the page to sign in again.'
    );
  });

  it('explains a permission refusal, with the reason when DevOps gave one', () => {
    expect(describeUpdateFailure(403, null)).toBe(
      'You do not have permission to change this work item in Azure DevOps.'
    );
    expect(describeUpdateFailure(403, 'TF237111: no permission under this area path')).toBe(
      'Azure DevOps refused the change: TF237111: no permission under this area path'
    );
  });

  it('tells a conflict, a missing item and throttling apart', () => {
    expect(describeUpdateFailure(409, null)).toMatch(/Someone else changed this work item/);
    expect(describeUpdateFailure(412, null)).toMatch(/Someone else changed this work item/);
    expect(describeUpdateFailure(404, null)).toMatch(/no longer exists/);
    expect(describeUpdateFailure(429, null)).toMatch(/limiting requests/);
  });

  it('does not pass on the detail of an outage', () => {
    expect(describeUpdateFailure(503, 'internal stack trace')).toBe(
      'Azure DevOps could not save the change right now. Try again shortly.'
    );
  });
});

describe('AzureDevOpsService.updateTicketFields', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws the status and a readable reason, not the raw body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ruleError, { status: 400, statusText: 'Bad Request' }))
    );

    const error = await new AzureDevOpsService('token', 'Contoso')
      .updateTicketFields('ABC Inc', 7, { priority: 2 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DevOpsApiError);
    expect((error as DevOpsApiError).status).toBe(400);
    expect((error as DevOpsApiError).message).toMatch(
      /^Azure DevOps rejected the change: TF401320/
    );
    // The JSON envelope stays in the server log.
    expect((error as DevOpsApiError).message).not.toContain('typeName');
  });

  it('answers 400 rather than a bare error when there is nothing to send', async () => {
    const error = await new AzureDevOpsService('token', 'Contoso')
      .updateTicketFields('ABC Inc', 7, {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DevOpsApiError);
    expect((error as DevOpsApiError).status).toBe(400);
  });
});

describe('updateFailureStatus', () => {
  it('passes through the statuses the client can act on', () => {
    for (const status of [400, 401, 403, 404, 409, 412, 429]) {
      expect(updateFailureStatus(status)).toBe(status);
    }
  });

  it('reports an upstream outage as a bad gateway', () => {
    expect(updateFailureStatus(500)).toBe(502);
    expect(updateFailureStatus(503)).toBe(502);
  });
});
