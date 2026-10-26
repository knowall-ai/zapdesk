/**
 * The order a ticket's conversation is shown in: newest first (#486).
 *
 * The newest message is the one an agent has to act on, so it goes at the top
 * rather than at the bottom of a long thread. This also matches the history
 * quoted under agent reply emails. Ties (same timestamp) fall back to the
 * higher comment id, which DevOps assigns in posting order.
 */
export function newestFirst<T extends { id: number | string; createdAt: Date | string }>(
  comments: readonly T[]
): T[] {
  const time = (c: T) => {
    const t = new Date(c.createdAt).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return [...comments].sort((a, b) => {
    const byTime = time(b) - time(a);
    if (byTime !== 0) return byTime;
    return Number(b.id) - Number(a.id);
  });
}
