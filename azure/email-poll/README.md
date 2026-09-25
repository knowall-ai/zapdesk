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

**Do not run both.** Two pollers against one mailbox can pick up the same
message before either marks it read. Disable the workflow in the same change
that deploys this.

## Layout

```
src/poll.ts                   the work, with no Functions dependency
src/poll.test.ts              15 tests against it
src/functions/pollMailbox.ts  the timer trigger, a thin adapter
host.json                     2-minute function timeout
```

The split is deliberate: `@azure/functions` cannot be exercised in a unit test
without the host, so everything worth asserting lives in `poll.ts` and the
trigger stays too small to hide a bug.

## Settings

| Setting                | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `ZAPDESK_BASE_URL`     | Base URL of the deployed app, e.g. `https://zapdesk.knowall.ai` |
| `EMAIL_WEBHOOK_SECRET` | Must match the app's own value, or every poll gets a 401        |
| `POLL_SCHEDULE`        | Optional NCRONTAB override; defaults to `0 * * * * *`           |
| `AzureWebJobsStorage`  | Required by the runtime to hold the timer's schedule state      |

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

Then set `ZAPDESK_BASE_URL` and `EMAIL_WEBHOOK_SECRET` under
**Configuration → Application settings**, ideally as Key Vault references.

### Set the alert before you cut over

Azure has no equivalent of a red cross in the Actions tab. Without an alert,
this fails exactly as silently as the workflow did — which is how that one sat
broken for four months before anyone noticed. Create an Application Insights
alert on failed `pollMailbox` invocations as part of the migration, not after.
