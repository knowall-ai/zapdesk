'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search, User as UserIcon, X } from 'lucide-react';
import type { User } from '@/types';
import Avatar from '../common/Avatar';
import ApprovalDetails from './ApprovalDetails';
import { useClickOutside, useDevOpsApi } from '@/hooks';
import { matchingMembers } from '@/hooks/useWorkItemActions';
import { buildIdentityString } from '@/lib/identity';

/** What a save changes: a string sets the field, null clears it. */
export interface ApprovalUpdate {
  /** "Name <email>", as DevOps takes an identity. */
  approvedBy?: string | null;
  /** A day, YYYY-MM-DD. */
  approvedDate?: string | null;
}

interface ApprovalFieldProps {
  project?: string;
  workItemType?: string;
  approvedBy?: User;
  approvedDate?: Date | string;
  /** Absent: shown read-only, as before. */
  onSave?: (update: ApprovalUpdate) => Promise<void>;
}

/** How long the field lookup and the members request may take. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Whether a work item type has the approval fields, per organisation, project
 * and type. Asked once and remembered: every ticket of a type gives the same
 * answer, and the panel should not refetch it for each ticket opened.
 */
const hasApprovalFields = new Map<string, Promise<boolean>>();

function typeHasApprovalFields(
  get: (url: string, options?: { signal?: AbortSignal }) => Promise<Response>,
  key: string,
  project: string,
  workItemType: string
): Promise<boolean> {
  const known = hasApprovalFields.get(key);
  if (known) return known;
  const lookup = get(
    `/api/devops/projects/${encodeURIComponent(project)}/workitemtypes/${encodeURIComponent(workItemType)}/fields/${encodeURIComponent('Custom.ApprovedBy')}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
    .then((response) => response.ok)
    .catch(() => {
      // A network failure says nothing about the type. Forget it, so the
      // next ticket opened asks again.
      hasApprovalFields.delete(key);
      return false;
    });
  hasApprovalFields.set(key, lookup);
  return lookup;
}

/** The stored day as YYYY-MM-DD, read in UTC like the panel shows it. */
function storedDay(date: Date | string | undefined): string {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** A full date the input can hold mid-typing, such as 0002-01-01, is not one to save. */
function isPlausibleDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2999;
}

/**
 * Approved By and Approved Date in the details panel, editable.
 *
 * The approval rule that once made these required has been switched off, so a
 * ticket can move without them and the move dialog only offers them. This is
 * where they can be set, or corrected, at any time.
 *
 * Shown only for a work item type that has the fields: a Task, or a project
 * whose process has no approval, shows what the read-only view would (which
 * is nothing, unless a value is somehow set).
 */
export default function ApprovalField({
  project,
  workItemType,
  approvedBy,
  approvedDate,
  onSave,
}: ApprovalFieldProps) {
  const { get, selectedOrganization } = useDevOpsApi();
  const organization = selectedOrganization?.accountName;
  const lookupKey =
    onSave && project && workItemType && organization
      ? `${organization}|${project}|${workItemType}`
      : null;
  // The answer is kept with the type it is for, so another ticket's answer is
  // never read as this one's while its own lookup is still away.
  const [answer, setAnswer] = useState<{ key: string; has: boolean } | null>(null);
  const editable = lookupKey !== null && answer?.key === lookupKey && answer.has;

  useEffect(() => {
    if (!lookupKey || !project || !workItemType) return;
    let current = true;
    typeHasApprovalFields(get, lookupKey, project, workItemType)
      .then((has) => {
        if (current) setAnswer({ key: lookupKey, has });
      })
      .catch(() => {
        // Stays read-only.
      });
    return () => {
      current = false;
    };
  }, [get, lookupKey, project, workItemType]);

  if (!editable || !onSave || !project) {
    return <ApprovalDetails approvedBy={approvedBy} approvedDate={approvedDate} />;
  }
  return (
    <Editor
      // A new stored day starts a fresh draft, so a save, or another ticket,
      // shows its own date rather than what was typed before.
      key={storedDay(approvedDate)}
      project={project}
      approvedBy={approvedBy}
      approvedDate={approvedDate}
      onSave={onSave}
      get={get}
    />
  );
}

function Editor({
  project,
  approvedBy,
  approvedDate,
  onSave,
  get,
}: {
  project: string;
  approvedBy?: User;
  approvedDate?: Date | string;
  onSave: (update: ApprovalUpdate) => Promise<void>;
  get: (url: string, options?: { signal?: AbortSignal }) => Promise<Response>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<User[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const day = storedDay(approvedDate);
  const [draftDay, setDraftDay] = useState(day);
  const savingRef = useRef(false);
  const dateId = useId();

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);
  const pickerRef = useClickOutside<HTMLDivElement>(close, isOpen);

  useEffect(() => {
    if (!isOpen || members !== null) return;
    let current = true;
    setMembersFailed(false);
    get(`/api/devops/projects/${encodeURIComponent(project)}/members`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`members: ${response.status}`);
        const data = (await response.json()) as { members?: User[] };
        if (current) setMembers(data.members ?? []);
      })
      .catch((error) => {
        console.error('Failed to fetch members:', error);
        if (current) setMembersFailed(true);
      });
    return () => {
      current = false;
    };
  }, [isOpen, members, get, project]);

  const filtered = useMemo(() => matchingMembers(members ?? [], search), [members, search]);

  const save = useCallback(
    async (update: ApprovalUpdate) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsSaving(true);
      try {
        await onSave(update);
      } catch {
        // The page reports the failure; put the date back to what is stored.
        setDraftDay(day);
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [onSave, day]
  );

  const commitDay = () => {
    if (draftDay === day) return;
    if (draftDay === '') {
      void save({ approvedDate: null });
      return;
    }
    if (!isPlausibleDay(draftDay)) {
      setDraftDay(day);
      return;
    }
    void save({ approvedDate: draftDay });
  };

  return (
    <>
      <div className="relative" ref={pickerRef}>
        <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
          Approved By
        </label>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isSaving}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="flex w-full cursor-pointer items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <span
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              <Loader2 size={14} className="animate-spin" />
              Updating...
            </span>
          ) : approvedBy ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar
                key={`${approvedBy.id}|${approvedBy.avatarUrl ?? ''}`}
                name={approvedBy.displayName}
                image={approvedBy.avatarUrl}
                size="sm"
              />
              <span className="truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                {approvedBy.displayName}
              </span>
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Not approved
            </span>
          )}
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        </button>

        {isOpen && (
          <div
            className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="border-b p-2" style={{ borderColor: 'var(--border)' }}>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute top-1/2 left-2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  aria-label="Search approvers"
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input w-full pl-7 text-sm"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-48 overflow-auto" role="listbox">
              {approvedBy && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void save({ approvedBy: null });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <UserIcon size={14} />
                  Clear approver
                </button>
              )}
              {membersFailed ? (
                <p className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nobody could be loaded. Close this and try again.
                </p>
              ) : members === null ? (
                <div
                  className="flex items-center justify-center gap-2 p-3 text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Loader2 size={14} className="animate-spin" />
                  Loading...
                </div>
              ) : filtered.length === 0 ? (
                <p className="p-3 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  No users found
                </p>
              ) : (
                filtered.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={member.id === approvedBy?.id}
                    onClick={() => {
                      close();
                      void save({ approvedBy: buildIdentityString(member) });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                  >
                    <Avatar name={member.displayName} image={member.avatarUrl} size="sm" />
                    {member.displayName}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor={dateId}
          className="mb-1 block text-xs uppercase"
          style={{ color: 'var(--text-muted)' }}
        >
          Approved Date
        </label>
        <div className="flex items-center gap-1">
          <input
            id={dateId}
            type="date"
            value={draftDay}
            disabled={isSaving}
            onChange={(e) => setDraftDay(e.target.value)}
            // Saved when the field is left, not on every change: typing a
            // year passes through 0002, 0020 and 0202, each a valid date.
            onBlur={commitDay}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDay();
            }}
            className="input w-full text-sm"
          />
          {day && (
            <button
              type="button"
              onClick={() => {
                setDraftDay('');
                void save({ approvedDate: null });
              }}
              disabled={isSaving}
              aria-label="Clear approved date"
              title="Clear approved date"
              className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
