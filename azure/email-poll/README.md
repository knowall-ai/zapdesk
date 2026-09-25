# ZapDesk mailbox poller (Azure Functions)

A timer trigger that asks the deployed app to drain the support mailbox, once a
minute. It replaces `.github/workflows/email-poll.yml`, which did the same job
on a schedule.

## Why it exists

Two hard limits made a scheduled workflow the wrong home for this:

- **The schedule floor is five minutes.** A comment in the workflow claimed
  `'* * * * *'` works on paid plans; it does not.
- **Scheduled workflows stop after 60 days of repository inactivity**, quietly,
  and stay stopped until somebody notices and re-enables them.

A timer trigger has neither limit. The trade is visibility: a failed run here
leaves a trace in Application Insights rather than a red ✗ on a page someone
might glance at, which is what the alert below is for.

### Cutover

**Never let both run at once, and never verify by overlapping them.** Each poll
lists unread messages and only then marks them read, and `POST /api/email/poll`
has no concurrency guard and no idempotency on the Graph message id. Two
pollers can therefore both pick up one message and file it twice — a duplicate
ticket, or a comment posted twice on a real customer thread.

A gap is safe where an overlap is not: mail simply waits unread in the mailbox
and the next poll drains it. So hand over with a gap, never a handshake.

1. Deploy with `AzureWebJobs.pollMailbox.Disabled` set to `true`. The Function
   is installed and its settings are loaded, but the timer does not fire.
2. Check the deployment came up and the settings are right — a missing one
   shows up here, before anything is polling.
3. Disable `.github/workflows/email-poll.yml`. Nothing is polling now.
4. Remove `AzureWebJobs.pollMailbox.Disabled`, or set it to `false`.
5. Watch for a successful `pollMailbox` invocation in Application Insights.

Rollback is the same steps backwards: disable the Function, re-enable the
workflow. Whatever arrived in between is still sitting unread and gets drained
by whichever poller comes back.

## Layout

```
src/poll.ts                   the work, with no Functions dependency
src/poll.test.ts              unit tests against it
src/functions/pollMailbox.ts  the timer trigger, a thin adapter
host.json                     2-minute function timeout
```

The split is deliberate: `@azure/functions` cannot be exercised in a unit test
without the host, so everything worth asserting lives in `poll.ts` and the
trigger stays too small to hide a bug.

## Settings

All four are required. None has a default.

| Setting                | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `APP_URL`              | Base URL of the deployed app, e.g. `https://zapdesk.knowall.ai` |
| `EMAIL_WEBHOOK_SECRET` | Must match the app's own value, or every poll gets a 401        |
| `POLL_SCHEDULE`        | NCRONTAB expression; `0 * * * * *` is every minute              |
| `AzureWebJobsStorage`  | Required by the runtime to hold the timer's schedule state      |

`APP_URL` is the same variable the deploy workflow sets on the web app, named
the same thing on purpose: one value, whichever resource is reading it.

`readConfig` fails loudly and names whichever setting is missing, rather than
polling a half-configured endpoint. A missing base URL is how inbound mail
stopped for four months without anyone noticing.

**NCRONTAB's sixth field is optional second-level precision.** Six fields put
seconds first, so cron's `*/5 * * * *` may be written `0 */5 * * * *`; the
five-field form is accepted too and runs at second 0. Verified against Core
Tools 4.12.1 — a five-field expression loads and fires on the minute.

## Running it locally

Needs the app on `http://localhost:3102` and a storage emulator.

```bash
npm install
cp local.settings.json.example local.settings.json   # then fill in the secret
npx azurite --silent --location <a path outside this repo>
npm start
```

`local.settings.json` holds the real webhook secret and is gitignored — it is
this project's `.env.local`. Never commit it.

```bash
npm test         # unit tests
npm run build    # tsc
```

## Deploying

```bash
func azure functionapp publish <function-app-name>
```

Then set all four under **Configuration → Application settings**, ideally as
Key Vault references.

They fail at different moments, which matters when reading a trace. A missing
`POLL_SCHEDULE` throws at module load, so the Function never registers. A
missing `APP_URL` or `EMAIL_WEBHOOK_SECRET` is only reached when `readConfig`
runs inside an invocation, so the Function loads cleanly and then fails on
every tick. Both name the setting.

### Set the alert before you cut over

Nothing here surfaces a failure on its own — a failed poll is a trace in
Application Insights and nothing else, and a mailbox that has stopped being
drained looks exactly like a mailbox with nothing in it. Create an alert on
failed `pollMailbox` invocations as part of the migration, not after it.
