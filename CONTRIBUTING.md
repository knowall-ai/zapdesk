# Contributing to ZapDesk

Thanks for helping. This guide covers the one rule that matters most, keeping private information out of the repository, and then the mechanics of a pull request.

## This repository is public

Everything you commit here is published to the internet: code, docs, tests, fixtures, screenshots, commit messages, branch names, and the text of issues, pull requests and review comments.

Treat it as **permanent**. A force-push or a follow-up commit doesn't delete anything. GitHub keeps old commits reachable by their hash, the pull request timeline links to them, and the description's edit history keeps earlier versions. Getting something truly removed takes a request to GitHub Support. It's far cheaper not to publish it in the first place.

### Never commit

- **Secrets**: tokens, personal access tokens (PATs), client secrets, API keys, connection strings, session cookies, `.env` files. Configuration goes in `.env.local` (git-ignored) or the App Service settings, and examples go in `.env.example` with placeholder values.
- **Email addresses** of real people or customers. Spam bots scrape public repositories. Use `@example.com`, `@example.test` or `@yourdomain.com` instead. The one exception is the published support address, which already appears in the product UI.
- **Customer information**: client, organisation and project names, their domains, work item titles and contents, ticket text, comments and attachments.
- **Real people's names**, other than maintainers appearing as git authors. This includes colleagues, customers and the requesters or assignees on real tickets.
- **Internal identifiers**: tenant and client IDs, subscription IDs, internal URLs, and the names of production resources such as resource groups or App Services.
- **Logs, HAR files, database dumps or API responses** copied from a real organisation.

### Screenshots

Screenshots are the easiest way to leak data by accident, because a single frame can show dozens of real names at once.

1. **Capture from the demo organisation only.** Use the `KnowAllTest` Azure DevOps organisation, whose projects are fictional (ABC Inc, Contoso Ltd, DEF Inc). Never capture from a production organisation. If the demo org lacks the data your screenshot needs, create fictional work items, pull requests or comments there.
2. **Check every pixel before committing.** Look for people's names, avatars, email addresses, organisation and project names, browser tabs, bookmarks, notification toasts, and anything in the sidebar or header.
3. **Hide or crop anything real** that's still on screen, such as a group belonging to a real colleague. Say what you hid in the pull request description.
4. **If in doubt, leave it out.**

Screenshots for a pull request go in `docs/screenshots/` on its branch. Link to them from the description with a `raw.githubusercontent.com` URL pinned to the commit hash.

### Test data

Use fictional values in tests, fixtures, seed scripts and examples: people such as _Alex Morgan_ or _Sam Taylor_, companies such as _Contoso_ or _ABC Inc_, and addresses at `example.com` or `example.test`. Don't copy a real ticket into a test, even with its name changed. Write a new one.

### If something slips through

1. **Secret?** Revoke or rotate it immediately. Assume it was copied the moment it was pushed.
2. **Not merged yet?** Rewrite the branch so no commit contains it (squash, then `git push --force-with-lease`). Then remove it from the pull request description and comments.
3. **Tell a maintainer.** They can ask GitHub Support to purge cached views of the old commits and the pull request's history.

A new commit that deletes the file is not enough. The old commit is still public.

## Making a change

1. Branch from `main`, using a prefix: `feat/`, `fix/`, `docs/`, `chore/`.
2. Run the checks before every push. CI runs the same ones:

   ```bash
   bun run check      # typecheck, lint and Prettier
   bunx vitest run    # unit tests
   ```

3. Open a pull request against `main` with a [Conventional Commits](https://www.conventionalcommits.org/) title, such as `feat: …` or `fix: …`. For `feat`, `fix`, `perf` and `refactor` changes, the body must include a `Fixes #123` line for the issue it closes. CI checks this.
4. For a UI change, include screenshots (see above) and a short test plan.

See [`CLAUDE.md`](CLAUDE.md) for the project structure and code style, and [`docs/`](docs/) for setup, deployment and troubleshooting.
