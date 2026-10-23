# AGENTS.md

Guidance for AI coding agents (Codex, Copilot, Claude Code and others) working in this repository.

ZapDesk is a Zendesk-style support portal backed by Azure DevOps: Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Bun for local development. **[`CLAUDE.md`](CLAUDE.md) is the full project guide** (architecture, code style, common tasks, environment variables), and it applies to every agent, not only Claude. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers pull requests.

## Public Repository: No Private Information

**This repository is public.** Everything committed is published permanently: code, docs, tests, fixtures, screenshots, commit messages, branch names, and the text of issues, pull requests and review comments. A force-push or a deleting commit doesn't remove anything. GitHub keeps old commits reachable by their hash, and only GitHub Support can purge them.

Never commit or post:

- **Secrets**: tokens, PATs, client secrets, API keys, connection strings, session cookies, `.env` files.
- **Email addresses** of real people or customers. Use `@example.com` or `@example.test`. The published support address is the one exception.
- **Customer information**: client, organisation and project names, domains, and work item, ticket and comment content.
- **Real people's names**, other than maintainers as git authors. This covers colleagues, customers, requesters and assignees.
- **Internal identifiers**: tenant, client and subscription IDs, internal URLs, and production resource names.
- **Logs, HAR files, dumps or API responses** from a real organisation.

**Screenshots**: capture from the `KnowAllTest` Azure DevOps demo organisation only. Its projects are fictional (ABC Inc, Contoso Ltd, DEF Inc). Create fictional work items or pull requests there if you need data. Never capture from a production organisation. Check every frame for names, avatars, emails, org names and toasts, hide or crop anything real, and say in the PR what you hid. If in doubt, leave it out.

**Test data**: use fictional names (Alex Morgan, Sam Taylor), companies (Contoso, ABC Inc) and `example.com` addresses. Don't copy real tickets, even renamed.

**If something slips through**: rotate any secret at once, rewrite the unmerged branch so no commit contains it, clean the PR description and comments, and tell a maintainer so they can ask GitHub Support to purge it.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide.

## Before you push

```bash
bun run check      # typecheck, lint and Prettier
bunx vitest run    # unit tests
```

Pull request titles follow Conventional Commits (`feat: …`, `fix: …`). For `feat`, `fix`, `perf` and `refactor` changes, the body needs a `Fixes #123` line. CI enforces both.
