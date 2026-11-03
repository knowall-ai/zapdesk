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
  'Microsoft.VSTS.Common.ClosedDate',
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

/**
 * The Kanban board's own batch read asks for a different set: it needs the
 * iteration path, and none of the long text the ticket list shows.
 *
 * It is split the same way and for the same reason. The board named its three
 * non-`System.*` fields unconditionally, which is the mistake this module was
 * written to stop -- two of them are already listed above as unsafe, so the
 * board was exposed to a `400 TF51535` taking the whole board down, not just a
 * column. Nothing had gone wrong only because every organisation reached so far
 * happens to define them.
 */
export const CORE_BOARD_FIELDS = [
  'System.Title',
  'System.State',
  'System.WorkItemType',
  'System.AssignedTo',
  'System.ChangedDate',
  'System.CreatedDate',
  'System.TeamProject',
  'System.Tags',
  'System.IterationPath',
] as const;

/** Each requested only when the organisation defines it. */
export const OPTIONAL_BOARD_FIELDS = [
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  // Windows the closed columns (#6713). Left out, `closedDateOf` falls back to
  // ChangedDate, so the board keeps working on the less precise date rather
  // than failing.
  'Microsoft.VSTS.Common.ClosedDate',
] as const;

/** The board fields to request from an organisation that defines `available`. */
export function boardFieldsToRequest(available: ReadonlySet<string> | null): string[] {
  const core = [...CORE_BOARD_FIELDS];
  if (!available) return core;
  return [...core, ...OPTIONAL_BOARD_FIELDS.filter((field) => available.has(field))];
}
