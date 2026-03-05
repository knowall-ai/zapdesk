/**
 * GitHub utility functions
 *
 * TODO: Implement shared helpers for GitHub issue URL construction
 * to reduce duplication across components.
 *
 * Approach: Use the same pattern as the DevOps org switcher:
 * 1. User authenticates via GitHub OAuth
 * 2. Fetch repos/orgs the user has access to via GitHub API
 * 3. Let user select which repo to use for issue creation
 *
 * This avoids hardcoding repository URLs and provides dynamic discovery.
 */
