# ZapDesk mailbox poller (Azure Functions)

A timer trigger that asks the deployed app to drain the support mailbox, once a
minute. It is the Azure equivalent of `.github/workflows/email-poll.yml`, which
does the same thing on a GitHub Actions schedule.

**Nothing is retired by this project existing.** The workflow is still the
deployed mechanism. Adopting this one is a separate decision — see
_Should you actually switch?_ below.

## Why it exists

|                    | GitHub Actions                                            | This                                |
| ------------------ | --------------------------------------------------------- | ----------------------------------- |
| Fastest schedule   | **5 minutes**, on every plan                              | 1 minute, or faster                 |
| Punctuality        | Best-effort; routinely late under load                    | Timer-driven                        |
| Auto-disable       | Scheduled workflows stop after 60 days of repo inactivity | Never                               |
| Failure visibility | Red ✗ in the Actions tab                                  | Application Insights **only**       |
| Cost (public repo) | Free                                                      | Storage account, roughly £1–2/month |

The 5-minute floor is a hard GitHub limit; a comment in the workflow claims
`'* * * * *'` works on paid plans, and that is not true.

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

`ZAPDESK_BASE_URL` is the setting whose absence caused the GitHub workflow to
fail 100 runs in a row. `readConfig` fails loudly and names it, because in
Azure there is no red ✗ — only a trace nobody reads unless an alert fires.

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

## Should you actually switch?

Only after the existing workflow has been proven to work. The polling failures
were never about the host: `ZAPDESK_BASE_URL` was simply never set as a repo
secret. Migrating first moves a broken configuration somewhere that costs money
and reports failure less visibly.

The strong case for switching arrives if ZapDesk ever becomes a private
repository. Polling every minute is then roughly 43,000 Actions minutes a
month against a 2,000–3,000 free allowance, and this project stops being a
preference.
