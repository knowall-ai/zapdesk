# CLAUDE.md - DevDesk Project Guidelines

This document provides guidance for AI assistants (like Claude) working on the DevDesk project.

## Project Overview

DevDesk is a Zendesk-style support ticketing portal that integrates with Azure DevOps. It allows clients to view and manage support tickets through a familiar interface while using Azure DevOps as the backend work item tracker.

## Architecture

### Tech Stack

- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Authentication**: NextAuth.js with Azure AD provider
- **Backend API**: Azure DevOps REST API
- **Deployment**: Azure App Service

### Key Concepts

- **Tickets** = Azure DevOps work items tagged with "ticket"
- **Organizations** = Azure DevOps projects
- **Customers** = Work item requesters/creators

## Code Style Guidelines

### TypeScript

- Use strict TypeScript with explicit types
- Prefer interfaces over types for object shapes
- Use `type` for unions, intersections, and utility types
- Export types from `@/types/index.ts`

### React Components

- Use functional components with hooks
- Prefer `'use client'` directive for interactive components
- Keep components focused and single-purpose
- Use CSS variables for theming (defined in globals.css)

### File Organization

```
src/
├── app/          # Next.js App Router pages and API routes
├── components/   # Reusable React components
│   ├── layout/   # Layout components (Sidebar, Header, MainLayout)
│   ├── common/   # Shared UI components (Avatar, StatusBadge)
│   └── tickets/  # Ticket-specific components
├── lib/          # Utility functions and services
└── types/        # TypeScript type definitions
```

### Naming Conventions

- **Files**: kebab-case for multi-word files, PascalCase for components
- **Components**: PascalCase (e.g., `TicketList`, `StatusBadge`)
- **Functions**: camelCase (e.g., `fetchTickets`, `handleSubmit`)
- **CSS Variables**: kebab-case with `--` prefix (e.g., `--primary`, `--text-muted`)

## Development Guidelines

### Adding New Features

1. Create types in `src/types/index.ts`
2. Add API route in `src/app/api/`
3. Create components in appropriate `src/components/` subfolder
4. Add page in `src/app/`
5. Update documentation

### Azure DevOps Integration

- All DevOps API calls go through `src/lib/devops.ts`
- Use the user's OAuth token for authenticated requests
- Use PAT (Personal Access Token) for service account operations (email webhook)
- Work items must have "ticket" tag to appear in DevDesk

### Authentication Flow

1. User clicks "Sign in with Microsoft"
2. Redirected to Azure AD for authentication
3. Token includes Azure DevOps scope
4. Token stored in NextAuth session
5. API routes extract token from session

### Error Handling

- Return appropriate HTTP status codes from API routes
- Log errors server-side with `console.error`
- Show user-friendly error messages in UI
- Handle loading states in components

## Testing

### Manual Testing Checklist

1. Sign in with Microsoft account
2. View ticket list (should show work items tagged "ticket")
3. Click on a ticket to view details
4. Add a comment
5. Change ticket status
6. View organizations and customers

### Playwright Tests

Tests are in `/tests` directory. Run with:

```bash
npm run test
```

## Code Quality & CI/CD

### Running Checks Locally

**CRITICAL: ALWAYS run `npm run check` before pushing to ensure CI will pass.** Failing to do so may cause CI/CD pipeline failures.

Before pushing code, run all checks to ensure CI will pass:

```bash
# Run all checks at once (recommended)
npm run check

# Individual checks
npm run typecheck      # TypeScript type checking
npm run lint           # ESLint code linting
npm run lint:fix       # ESLint with auto-fix
npm run format:check   # Prettier formatting check
npm run format         # Auto-format with Prettier
```

### CI Pipeline

The CI workflow (`.github/workflows/ci.yml`) runs automatically on:

- Every pull request to `main`
- Every push to `main`

It runs these jobs in parallel, then builds if all pass:

1. **Lint** - ESLint checks
2. **Format** - Prettier formatting verification
3. **Type Check** - TypeScript compilation check
4. **Build** - Next.js production build (runs after other checks pass)

All checks must pass before a PR can be merged.

### Code Style

- **Prettier** handles formatting (see `.prettierrc`)
- **ESLint** handles code quality (see `eslint.config.mjs`)
- **TypeScript** handles type safety (see `tsconfig.json`)

When making changes:

1. Run `npm run format` to auto-format code
2. Run `npm run lint:fix` to auto-fix linting issues
3. Run `npm run check` to verify all checks pass

## Common Tasks

### Adding a New View Filter

1. Add filter definition in `src/app/api/devops/tickets/route.ts`
2. Add view to sidebar in `src/components/layout/Sidebar.tsx`
3. Add title mapping in `src/app/tickets/page.tsx`

### Adding a New Status

1. Add to `TicketStatus` type in `src/types/index.ts`
2. Add CSS class in `src/app/globals.css`
3. Add mapping in `mapStateToStatus` in `src/lib/devops.ts`
4. Add to `StatusBadge` config in `src/components/common/StatusBadge.tsx`

### Modifying Theme Colors

1. Update CSS variables in `src/app/globals.css` under `:root`
2. Brand color is `--primary` (bright green: #22c55e)
3. Background is dark theme by default

## Environment Variables

| Variable                 | Description                               | Required              |
| ------------------------ | ----------------------------------------- | --------------------- |
| `NEXTAUTH_URL`           | Base URL of the application               | Yes                   |
| `NEXTAUTH_SECRET`        | Secret for NextAuth encryption            | Yes                   |
| `AZURE_AD_CLIENT_ID`     | Azure AD application client ID            | Yes                   |
| `AZURE_AD_CLIENT_SECRET` | Azure AD application client secret        | Yes                   |
| `AZURE_AD_TENANT_ID`     | Azure AD tenant ID (or 'common')          | Yes                   |
| `AZURE_DEVOPS_ORG`       | Azure DevOps organization name            | Yes                   |
| `AZURE_DEVOPS_PAT`       | Personal Access Token for service account | For email integration |
| `EMAIL_WEBHOOK_SECRET`   | Secret for email webhook authentication   | For email integration |

## Deployment

### Azure App Service

1. Create Azure App Service (Node.js 18+)
2. Configure environment variables in App Service Configuration
3. Deploy via GitHub Actions (see `.github/workflows/deploy.yml`)
4. Ensure Azure AD redirect URI includes production URL

### Pre-deployment Checklist

- [ ] All environment variables configured
- [ ] Azure AD redirect URIs updated
- [ ] NEXTAUTH_URL set to production URL
- [ ] PAT has correct permissions for DevOps org

## Troubleshooting

See `/docs/TROUBLESHOOTING.adoc` for common issues and solutions.

### Maintaining the Troubleshooting Guide

When you encounter or help resolve an issue that admins or users might face:

1. **Add it to `/docs/TROUBLESHOOTING.adoc`** in the appropriate section
2. Use the table format with clear Problem/Solution columns:
   ```asciidoc
   |**Problem description**
   |Solution with specific steps or commands.
   ```
3. Be specific about error messages and exact solutions
4. Include relevant commands, URLs, or configuration values
5. Group related issues under appropriate section headers

## Contact

- **Project Owner**: KnowAll AI
- **Repository**: https://github.com/knowall-ai/devdesk
- **Support**: support@knowall.ai
