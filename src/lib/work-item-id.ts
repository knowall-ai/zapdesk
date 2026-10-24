import { notFound } from 'next/navigation';

/** DevOps stores work item ids as 32-bit integers. */
export const MAX_WORK_ITEM_ID = 2_147_483_647;

/**
 * DevOps work item ids are positive integers. Anything else can never match a
 * work item. Pages answer with a real HTTP 404 instead of a 200 "not found"
 * page; API handlers answer 400 without asking DevOps.
 */
export function isWorkItemId(id: string): boolean {
  return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= MAX_WORK_ITEM_ID;
}

/**
 * The id as a number, or null when it is not a work item id. Unlike
 * `parseInt`, "123abc" and "-1" are rejected rather than forwarded as 123.
 */
export function parseWorkItemId(id: string): number | null {
  return isWorkItemId(id) ? Number(id) : null;
}

export async function notFoundUnlessWorkItemId(params: Promise<{ id: string }>): Promise<void> {
  const { id } = await params;
  if (!isWorkItemId(id)) notFound();
}
