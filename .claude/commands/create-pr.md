# Create Pull Request

## Rules

1. **Always create a new branch** from `main` before starting any fix. Branch naming: `fix/<issue-number>-<short-description>` or `feat/<issue-number>-<short-description>`
2. **One branch per issue** — never mix fixes for different issues on the same branch
3. **Run checks before pushing** — always run `npm run typecheck` and format with Prettier before committing
4. **Preserve existing PR content** — when updating a PR description, NEVER overwrite existing content. Append new information below existing sections. Screenshots added by the user MUST be preserved.
5. **Link related issues** — use `Closes #N` in the PR body for each issue being fixed
6. **Reply to review comments** — after fixing Copilot or reviewer comments, reply to the comment with the fix commit hash

## PR Creation Format

```
gh pr create --title "<type>: <short title>" --body "$(cat <<'EOF'
## Summary
<bullet points describing changes>

## Test plan
- [ ] <testing checklist items>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## PR Update Rules

When adding fixes to an existing PR, **append** to the summary — do NOT replace it. Use this pattern:

```
### Additional fixes
- <new fix description>
```

This preserves any screenshots or content the user has added to the PR description.

## Workflow

1. `git checkout main && git pull`
2. `git checkout -b fix/<issue>-<desc>`
3. Make changes
4. `npx prettier --write <files>` then `npm run typecheck`
5. **Run locally** — start `npm run dev`, confirm the fix works, and wait for user to test before proceeding
6. Commit with descriptive message + `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
7. `git push -u origin <branch>`
8. Create PR with `gh pr create`
9. Address review comments, reply to each
