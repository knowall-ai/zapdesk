import { notFound } from 'next/navigation';

/**
 * DevOps work item ids are positive integers. Anything else can never match a
 * ticket, so answer with a real HTTP 404 instead of a 200 "not found" page.
 */
export function isWorkItemId(id: string): boolean {
  return /^[1-9]\d{0,9}$/.test(id);
}

export async function notFoundUnlessWorkItemId(params: Promise<{ id: string }>): Promise<void> {
  const { id } = await params;
  if (!isWorkItemId(id)) notFound();
}
