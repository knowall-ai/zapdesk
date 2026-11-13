'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import RequiredFieldsDialog from './RequiredFieldsDialog';
import { matchingMembers } from '@/hooks/useWorkItemActions';
import type { BoardGet, PendingBoardStateChange } from '@/hooks/useBoardStateChange';
import type { User } from '@/types';

/**
 * The required-fields dialog for a state change started on a board (#662).
 *
 * Self-contained on purpose. A board page's job is to say what the change is
 * and what to do with the answer; the field values, the people picker and its
 * search are this dialog's business, and keeping them here means the two
 * boards share one copy rather than growing one each.
 *
 * `useWorkItemActions` cannot do this job: it is built around a single work
 * item that a page has open, and a board has a column of them.
 */

/** How long the members request may take before the picker gives up. */
const MEMBERS_TIMEOUT_MS = 10_000;

interface Props {
  pending: PendingBoardStateChange | null;
  /** The write is in flight; the dialog's buttons go quiet. */
  isSubmitting: boolean;
  get: BoardGet;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
}

export default function BoardStateChangeDialog({
  pending,
  isSubmitting,
  get,
  onSubmit,
  onCancel,
}: Props) {
  if (!pending) return null;
  // Keyed by the transition, so each one starts with an empty form.
  //
  // The values and the picker search used to be reset by an effect. Mounting a
  // fresh dialog says the same thing without one, and there is no moment when
  // the previous card's answers are on screen -- which on an identity field
  // meant approving as whoever the last card was approved by.
  return (
    <Fields
      key={`${pending.itemId}:${pending.state}`}
      pending={pending}
      isSubmitting={isSubmitting}
      get={get}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function Fields({
  pending,
  isSubmitting,
  get,
  onSubmit,
  onCancel,
}: Props & { pending: PendingBoardStateChange }) {
  // Only an identity field needs a person, and the request is not worth making
  // for a transition that just wants a date.
  const needsPeople = pending.fields.some((field) => field.isIdentity);
  const { project } = pending;

  const [values, setValues] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<User[]>([]);
  // Starts true when people are wanted, rather than being switched on by the
  // effect below: an empty list must not read as "nobody to pick" while the
  // request that will fill it is still in flight.
  const [membersLoading, setMembersLoading] = useState(needsPeople);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!needsPeople) return;
    /** False once this dialog has gone, so a late answer is dropped. */
    let current = true;
    get(`/api/devops/projects/${encodeURIComponent(project)}/members`, {
      // Neither this helper nor the members route bounds the wait, and the
      // picker says "Loading…" until it settles.
      signal: AbortSignal.timeout(MEMBERS_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { members?: User[] };
        if (current) setMembers(data.members ?? []);
      })
      .catch((error) => {
        // Non-fatal: the dialog then says plainly that it found nobody rather
        // than spinning for ever on a request that already failed (#652).
        console.error('Failed to fetch members:', error);
      })
      .finally(() => {
        if (current) setMembersLoading(false);
      });
    return () => {
      current = false;
    };
  }, [needsPeople, project, get]);

  const filteredMembers = useMemo(() => matchingMembers(members, search), [members, search]);

  const handleFieldChange = useCallback((fieldRef: string, value: string) => {
    setValues((previous) => ({ ...previous, [fieldRef]: value }));
  }, []);

  const handleConfirm = useCallback(async () => {
    await onSubmit(values);
  }, [onSubmit, values]);

  return (
    <RequiredFieldsDialog
      targetType={pending.state}
      changing="state"
      requiredFields={pending.fields}
      fieldValues={values}
      onFieldChange={handleFieldChange}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      isUpdating={isSubmitting}
      members={members}
      membersLoading={membersLoading}
      memberSearch={search}
      onMemberSearchChange={setSearch}
      filteredMembers={filteredMembers}
    />
  );
}
