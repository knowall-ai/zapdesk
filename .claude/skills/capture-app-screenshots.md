# Capture App Screenshots

Capture 1280x720 screenshots of ZapDesk pages for pull requests, documentation and the landing page.

## Why a signed-in browser is needed

ZapDesk signs in with Microsoft through NextAuth, and every Azure DevOps call uses that user's token. There is no demo mode and no token a script can mint, so `scripts/capture-screenshots.mjs` attaches to a browser you have already signed in to (started with `--remote-debugging-port=9222`) and takes its shots in a fresh tab of that session.

## Prerequisites

1. **Dev server running**: `bun run dev` (port 3102)
2. **A browser with remote debugging**, signed in to ZapDesk:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/zapdesk-screenshots" http://localhost:3102
```

The separate `--user-data-dir` keeps this profile apart from your everyday browser, so you do not have to close it. Sign in with Microsoft in the window that opens. The profile remembers the sign-in for next time.

3. **Playwright installed**: already a dev dependency

## Demo data only

This repository is public. Capture from the **KnowAllTest** demo organization (ABC Inc, Contoso Ltd, DEF Inc), never from a real client's organization or project. The script selects the organization itself through the header switcher's saved choice, so pass `--org KnowAllTest` and check every image before attaching it anywhere.

## Running the script

```bash
node scripts/capture-screenshots.mjs --org KnowAllTest

# Only some shots, zoomed out, with the Live Dashboard on 90 days and GitHub work items only
node scripts/capture-screenshots.mjs --org KnowAllTest --only reporting --range 90 --source github --zoom 0.67

# From another machine: forward the dev server out and your browser's debug port back
ssh -L 3102:localhost:3102 -R 9222:localhost:9222 <dev-machine>
# then run the browser locally as above, and on the dev machine pass --cdp-url "http://[::1]:9222"
# (the reverse forward listens on the IPv6 loopback when the IPv4 port is taken)
```

### Options

| Option       | Environment variable | Default                 | Purpose                                                                                                                     |
| ------------ | -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--org`      | `ZAPDESK_ORG`        | (required)              | Azure DevOps organization shown in the header switcher                                                                      |
| `--only`     | `ZAPDESK_ONLY`       | all                     | Comma-separated shot names to capture                                                                                       |
| `--range`    | `ZAPDESK_RANGE`      | `30`                    | Live Dashboard period in days: `7`, `30`, `90` or `365`                                                                     |
| `--source`   | `ZAPDESK_SOURCE`     | `both`                  | Work item source switcher: `both`, `devops` or `github`                                                                     |
| `--base-url` | `ZAPDESK_BASE_URL`   | `http://localhost:3102` | ZapDesk URL                                                                                                                 |
| `--cdp-url`  | `CDP_URL`            | `http://localhost:9222` | Browser remote debugging URL                                                                                                |
| `--out`      | `ZAPDESK_OUT`        | `screenshots`           | Output folder. Only the default `screenshots/` is gitignored, so a custom path is not: check `git status` before committing |

The script exits non-zero if any shot fails and prints the `--only` list to retry.

## Shots

| Filename                 | Page         | What it shows                                                         |
| ------------------------ | ------------ | --------------------------------------------------------------------- |
| `tickets.png`            | `/tickets`   | The ticket list for the default view                                  |
| `kanban.png`             | `/kanban`    | The Kanban board grouped by project                                   |
| `reporting.png`          | `/reporting` | The Live Dashboard on the chosen range                                |
| `team-pull-requests.png` | `/team`      | The Team page scrolled to the Pull Requests card, on the chosen range |
| `team.png`               | `/team`      | Team activity and members                                             |
| `projects.png`           | `/projects`  | Projects with their SLA and email settings                            |
| `users.png`              | `/users`     | Users across the organization's projects                              |

The Team and Users shots show staff names and email addresses. Do not attach those to a public pull request or issue.

## Troubleshooting

### "ECONNREFUSED" error

No browser is listening on port 9222. Start one with the command above.

### "Redirected to /login"

The debug browser is not signed in. Sign in with Microsoft in that window and rerun.

### A shot times out waiting for the page

Each shot waits up to 30 seconds for the page heading and for spinners to go. Check the dev server is up, the browser is still signed in and the organization has data, then retry with `--only <name>`.
