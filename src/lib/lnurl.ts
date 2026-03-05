/**
 * LNURL utilities for Lightning Network payments
 */

/**
 * Generate a Lightning URI for wallet deep links
 * @param lightningAddress - e.g. 'alice@example.com'
 * @returns Lightning URI (e.g. 'lightning:alice@example.com')
 */
export function lightningUri(lightningAddress: string): string {
  return `lightning:${lightningAddress}`;
}
