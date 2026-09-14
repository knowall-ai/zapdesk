/**
 * Opt-in diagnostic logging for the Kanban drag-and-drop state change flow.
 *
 * A rejected drop crosses four layers — board component, page handler, API
 * route, DevOps service — so the useful evidence is spread across the browser
 * console and the server log. These helpers keep that trail available without
 * paying for it on every drag in production: they are no-ops unless enabled.
 *
 * Failure logging is deliberately *not* routed through here. It fires only
 * when a transition is actually rejected, which is the evidence issue #391
 * exists to collect, so it stays unconditional.
 */

/**
 * `NEXT_PUBLIC_DEBUG_KANBAN=true` turns the logs on anywhere. Setting it to
 * anything else turns them off, including in development. Leaving it unset
 * keeps them on outside production builds only.
 *
 * Split out from the module-level flag below so it can be tested without
 * reloading the module under a mutated `process.env`.
 */
export function debugEnabled(flag: string | undefined, nodeEnv: string | undefined): boolean {
  if (flag === 'true') return true;
  if (flag !== undefined) return false;
  return nodeEnv !== 'production';
}

// The literal `process.env.NEXT_PUBLIC_*` reference is required — Next.js
// inlines the value into the client bundle at build time by textual match, so
// a computed lookup would read as undefined in the browser.
export const kanbanDebugEnabled = debugEnabled(
  process.env.NEXT_PUBLIC_DEBUG_KANBAN,
  process.env.NODE_ENV
);

export function debugLog(...args: unknown[]): void {
  if (kanbanDebugEnabled) console.log(...args);
}

export function debugWarn(...args: unknown[]): void {
  if (kanbanDebugEnabled) console.warn(...args);
}
