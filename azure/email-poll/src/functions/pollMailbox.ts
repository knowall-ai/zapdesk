import { app, InvocationContext, Timer } from '@azure/functions';
import { drainMailbox, readConfig } from '../poll';

/**
 * Timer trigger that drains the support mailbox.
 *
 * The schedule is NCRONTAB, read from POLL_SCHEDULE. Six fields give
 * second-level precision with the leading field the seconds; a five-field cron
 * expression is also accepted and treated as second 0. `0 * * * * *` is every
 * minute.
 */
export async function pollMailbox(timer: Timer, context: InvocationContext): Promise<void> {
  const config = readConfig();

  // A timer trigger is a singleton, so an overrunning poll does not get a
  // second invocation alongside it — the tick is skipped instead, and the next
  // one arrives flagged. Worth logging: a silently missed poll looks exactly
  // like a mailbox with nothing in it.
  if (timer.isPastDue) {
    context.warn('Timer is past due — a previous poll overran, or the host restarted.');
  }

  const body = await drainMailbox(config);
  context.log(body);
}

// No default. A schedule is deployment configuration, and one baked in here
// would mean a Function App that polls on a cadence nobody chose and nothing
// records. Missing, it fails at load with the setting named, rather than
// registering a trigger whose timing is a surprise.
const schedule = process.env.POLL_SCHEDULE?.trim();
if (!schedule) {
  throw new Error(
    'POLL_SCHEDULE is not set. Set it on the Function App (Configuration > ' +
      'Application settings) to an NCRONTAB expression — "0 * * * * *" is every minute.'
  );
}

app.timer('pollMailbox', {
  schedule,
  runOnStartup: false,
  handler: pollMailbox,
});
