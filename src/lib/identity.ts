import type { User } from '@/types';

/**
 * Build full identity string for Azure DevOps: "DisplayName <email>"
 * Used by people picker fields (Assignee, Found By, etc.)
 */
export function buildIdentityString(member: User): string {
  if (member.email) {
    return `${member.displayName} <${member.email}>`;
  }
  return member.displayName;
}

/**
 * Extract display name from identity string "DisplayName <email>"
 * Handles plain names, "Name <email>" format, and empty strings.
 */
export function getDisplayNameFromIdentity(identity: string): string {
  if (!identity) return '';
  const trimmed = identity.trim();
  const ltIndex = trimmed.indexOf('<');
  if (ltIndex !== -1) {
    return trimmed.slice(0, ltIndex).trim();
  }
  return trimmed;
}
