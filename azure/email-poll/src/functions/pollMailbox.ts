import { app, InvocationContext, Timer } from '@azure/functions';
import { drainMailbox, readConfig } from '../poll';

/**
 * Timer trigger replacing the `Poll support mailbox` GitHub Action.
 *
 * The schedule is NCRONTAB. Six fields gives second-level precision, with the
 * leading field the seconds; a five-field cron expression is also accepted and
 * treated as second 0. Either way `0 * * * * *` is every minute, which GitHub's
 * scheduler could not offer: its floor is five minutes on every plan, and
 * scheduled runs are best-effort and routinely late under load.
 */
export async function pollMailbox(timer: Timer, context: InvocationContext): Promise<void> {
  const config = readConfig();

  // A timer trigger is a singleton, so an overrunning poll does not get a
  // second invocation alongside it — the tick is skipped instead, and the next
  // one arrives flagged. Worth logging: silently missed polls are how the
  // workflow this replaces went four months without anyone noticing.
  if (timer.isPastDue) {
    context.warn('Timer is past due — a previous poll overran, or the host restarted.');
  }

  const body = await drainMailbox(config);
  context.log(body);
}

app.timer('pollMailbox', {
  schedule: process.env.POLL_SCHEDULE || '0 * * * * *',
  runOnStartup: false,
  handler: pollMailbox,
});
