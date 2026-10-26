import { PauseCircle } from 'lucide-react';
import { buildStateTimeline, isPaused, pausedMillis } from '@/lib/sla-clock';
import { formatDuration } from '@/lib/sla';
import type { WorkItemUpdate } from '@/types';

interface SlaPausedNoteProps {
  /** The ticket's revision history, which is where state changes are recorded. */
  updates: readonly WorkItemUpdate[];
  createdAt: Date;
  /** Fixed value for tests; defaults to now. */
  now?: Date;
}

/**
 * How much of a ticket's SLA time was spent where nobody could act on it
 * (7386).
 *
 * The SLA badge beside this counts wall-clock time from creation, so a ticket
 * parked for three days burns three days of its target and the team is judged
 * on time it could not have used. Correcting that figure needs the ticket's
 * history, which is loaded on this screen but not on the lists -- so rather
 * than show a different number here from everywhere else, this states the
 * paused time next to the badge and leaves the badge alone.
 *
 * Renders nothing when the ticket was never paused, which is most of them.
 */
export default function SlaPausedNote({
  updates,
  createdAt,
  now = new Date(),
}: SlaPausedNoteProps) {
  const timeline = buildStateTimeline(updates, createdAt);
  const paused = pausedMillis(timeline, now);
  if (paused <= 0) return null;

  const stillPaused = isPaused(timeline);
  const duration = formatDuration(Math.round(paused / 60000));
  return (
    <p
      className="mt-1.5 flex items-start gap-1.5 text-xs"
      style={{ color: 'var(--text-muted)' }}
      role="note"
    >
      <PauseCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {stillPaused
          ? `Blocked now, ${duration} in total — the SLA badge above still counts it.`
          : `Spent ${duration} blocked, which the SLA badge above still counts.`}
      </span>
    </p>
  );
}
