import { sendStatusChangeNotification, assigneeEmailFrom } from '@/lib/email';
import { notifiesCustomer, stateMoved, statusChangeRecipient } from '@/lib/status-notification';

/**
 * Fire-and-forget email to the customer about a state change.
 *
 * Shared by every route that changes a ticket's state -- the ticket page
 * (`/state`) and the bulk actions on the tickets list (`/status`) -- so the
 * customer hears about a change once, whichever control the agent used
 * (https://github.com/knowall-ai/zapdesk/issues/728).
 *
 * Sent only when all of these hold, and each reason to stay quiet leaves a
 * line in the log:
 *
 * - The state really moved. Compared with what DevOps saved rather than with
 *   what was asked for, and an unreadable old state sends nothing rather than
 *   "Unknown -> X".
 * - The ticket arrived by email. #654 extended this to every ticket, mailing
 *   whoever created the work item -- usually a colleague, not a customer.
 * - The new state is one customers are told about.
 */
export function notifyStateChange(
  workItem: { fields?: Record<string, unknown> },
  ticketId: number,
  oldState: string | undefined,
  requestedState: string
) {
  const savedState = workItem.fields?.['System.State'];
  const newState =
    typeof savedState === 'string' && savedState.trim() ? savedState : requestedState;

  if (!oldState || !stateMoved(oldState, newState)) {
    console.log(
      oldState
        ? `[Email] Ticket #${ticketId} is still ${newState} - the state did not move, not notifying.`
        : `[Email] Ticket #${ticketId} moved to ${newState}, but its earlier state could not be read - not notifying.`
    );
    return;
  }

  const requesterEmail = statusChangeRecipient(workItem.fields);
  if (!requesterEmail) {
    console.log(
      `[Email] Ticket #${ticketId} moved to ${newState}, but it did not arrive by email (or has no usable email-from tag) - not notifying.`
    );
    return;
  }

  if (!notifiesCustomer(newState)) {
    console.log(
      `[Email] Ticket #${ticketId} moved to ${newState}, which customers are not told about - not notifying.`
    );
    return;
  }

  const subject = String(workItem.fields?.['System.Title'] || 'Your ticket');
  // Blind-copy the assigned engineer: this message is part of the customer's
  // thread, and until now only the agent's own replies reached them (#7384).
  const assigneeEmail = assigneeEmailFrom(workItem.fields?.['System.AssignedTo']);
  sendStatusChangeNotification(
    ticketId,
    subject,
    requesterEmail,
    oldState,
    newState,
    undefined,
    assigneeEmail,
    // The customer's organisation, so their manager is copied if one is set.
    String(workItem.fields?.['System.TeamProject'] ?? '')
  ).catch(() => {});
}
