/**
 * Which work item fields are safe to ask Azure DevOps for.
 *
 * The batch endpoint (`GET /_apis/wit/workitems?ids=...&fields=...`) is
 * all-or-nothing: name one field the organisation does not define and the whole
 * request fails with `400 TF51535: Cannot find field <name>`, so every work item
 * in the batch is lost rather than just that column.
 *
 * ZapDesk asked for `Custom.CustomerResponse`, which exists only in KnowAll's
 * customised process. Against any other organisation -- including every tenant
 * reached through the multi-tenant install -- the ticket list came back empty,
 * and because the per-project fetches run under `Promise.allSettled` the
 * failure was logged and swallowed rather than shown.
 *
 * So the field list is split: `System.*` fields are defined by every process,
 * and anything else is requested only once the organisation is known to have it.
 */

/** Defined by every process template, so always safe to request. */
export const CORE_TICKET_FIELDS = [
  'System.Title',
  'System.Description',
  'System.State',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.CreatedBy',
  'System.AssignedTo',
  'System.Tags',
  'System.TeamProject',
  'System.WorkItemType',
  'System.AreaPath',
] as const;

/**
 * Process-specific or customised fields. Each is requested only when the
 * organisation defines it; a missing one costs that column, not the whole list.
 */
export const OPTIONAL_TICKET_FIELDS = [
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.ResolvedReason',
  'Microsoft.VSTS.Common.Resolution',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.SystemInfo',
  'Custom.CustomerResponse',
  'Microsoft.VSTS.Scheduling.CompletedWork',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  'Microsoft.VSTS.Scheduling.OriginalEstimate',
] as const;

/**
 * The fields to request from an organisation that defines `available`.
 *
 * `available` of `null` means discovery itself failed. The core fields are then
 * requested alone: a list missing its priority column is worth having, an empty
 * one is not.
 */
export function ticketFieldsToRequest(available: ReadonlySet<string> | null): string[] {
  const core = [...CORE_TICKET_FIELDS];
  if (!available) return core;
  return [...core, ...OPTIONAL_TICKET_FIELDS.filter((field) => available.has(field))];
}
