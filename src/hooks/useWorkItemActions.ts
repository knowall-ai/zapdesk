'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { User, WorkItemState, WorkItemType } from '@/types';
import { ensureActiveState } from '@/types';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';

/**
 * Fields the process will demand for `state`, or none.
 *
 * Exported because the ticket page keeps its own copy of these controls rather
 * than using this hook; both ask the same question and must get the same
 * answer. An empty list also covers "the rules could not be read" -- the route
 * says so with `unavailable`, and the caller's job either way is to go ahead
 * and let the server's own error speak (#651).
 */
export async function fetchStateRequirements(
  get: (url: string) => Promise<Response>,
  workItemId: number,
  project: string,
  state: string
): Promise<RequiredField[]> {
  try {
    const response = await get(
      `/api/devops/tickets/${workItemId}/state-requirements?to=${encodeURIComponent(state)}&project=${encodeURIComponent(project)}`
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { fields?: RequiredField[] };
    return data.fields ?? [];
  } catch (err) {
    console.error('Failed to read state requirements:', err);
    return [];
  }
}

/**
 * Assignable people matching `search`, in name order.
 *
 * Stakeholders are dropped: they hold no work item licence, so DevOps refuses
 * an assignment to one and the pick would fail after the fact. Shared by the
 * assignee picker and both required-field dialogs, which had a copy each.
 */
function matchingMembers(members: User[], search: string): User[] {
  const needle = search.trim().toLowerCase();
  return members
    .filter((member) => {
      const stakeholder =
        member.accessLevel?.toLowerCase().includes('stakeholder') ||
        member.licenseType?.toLowerCase().includes('stakeholder');
      return !stakeholder;
    })
    .filter((member) => {
      if (!needle) return true;
      return (
        member.displayName.toLowerCase().includes(needle) ||
        member.email?.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** How long the members request may take before the picker gives up. */
const MEMBERS_TIMEOUT_MS = 10_000;

export interface RequiredField {
  referenceName: string;
  name: string;
  type: string;
  allowedValues?: string[];
  /**
   * The field holds a person, so it wants a picker rather than a text box.
   * Read from the field itself (#651) instead of a list of known field names,
   * which only ever covered the one field somebody had already hit.
   */
  isIdentity?: boolean;
}

interface UseWorkItemActionsOptions {
  project?: string;
  workItemType?: string;
  /**
   * The states to offer, when they are not a DevOps work item type's.
   *
   * A GitHub issue's states come from the GitHub process template (#567), not
   * from the project: asking DevOps for them would offer `Active` or
   * `Committed` on a card that can only take the six ZapDesk statuses, and
   * the write would be refused after the user had already chosen one.
   */
  states?: WorkItemState[];
  /** The work item whose transition rules apply; without it none are read. */
  workItemId?: number;
  onStateChange?: (state: string, additionalFields?: Record<string, string>) => Promise<void>;
  onAssigneeChange?: (assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (priority: number) => Promise<void>;
  onTypeChange?: (type: string, additionalFields?: Record<string, string>) => Promise<void>;
}

export interface WorkItemActions {
  // State dropdown
  isStateDropdownOpen: boolean;
  setIsStateDropdownOpen: (open: boolean) => void;
  availableStates: WorkItemState[];
  isLoadingStates: boolean;
  isUpdatingState: boolean;
  handleStateSelect: (state: string) => Promise<void>;

  // Assignee dropdown
  isAssigneeDropdownOpen: boolean;
  setIsAssigneeDropdownOpen: (open: boolean) => void;
  assigneeSearch: string;
  setAssigneeSearch: (search: string) => void;
  filteredMembers: User[];
  isLoadingMembers: boolean;
  isUpdatingAssignee: boolean;
  handleAssigneeSelect: (memberId: string | null) => Promise<void>;

  // Priority dropdown
  isPriorityDropdownOpen: boolean;
  setIsPriorityDropdownOpen: (open: boolean) => void;
  isUpdatingPriority: boolean;
  handlePrioritySelect: (priority: number) => Promise<void>;

  // Type dropdown
  isTypeDropdownOpen: boolean;
  setIsTypeDropdownOpen: (open: boolean) => void;
  availableTypes: WorkItemType[];
  isLoadingTypes: boolean;
  isUpdatingType: boolean;
  handleTypeSelect: (type: string) => Promise<void>;

  // Pending type change (required fields)
  pendingTypeChange: { type: string; requiredFields: RequiredField[] } | null;
  isLoadingRequiredFields: boolean;
  pendingTypeFieldValues: Record<string, string>;
  setPendingTypeFieldValue: (fieldRef: string, value: string) => void;
  confirmPendingTypeChange: () => Promise<void>;
  cancelPendingTypeChange: () => void;
  requiredFieldMembers: User[];
  isLoadingRequiredFieldMembers: boolean;
  pendingTypeMemberSearch: string;
  setPendingTypeMemberSearch: (search: string) => void;
  filteredPendingTypeMembers: User[];

  /** A state change waiting on fields the process requires (#651). */
  pendingStateChange: { state: string; requiredFields: RequiredField[] } | null;
  pendingStateFieldValues: Record<string, string>;
  setPendingStateFieldValue: (fieldRef: string, value: string) => void;
  confirmPendingStateChange: () => Promise<void>;
  cancelPendingStateChange: () => void;
  pendingStateMemberSearch: string;
  setPendingStateMemberSearch: (search: string) => void;
  filteredPendingStateMembers: User[];

  // Reset all dropdowns
  resetAll: () => void;
  // Reset available states (for when work item type changes)
  resetStates: () => void;
}

export function useWorkItemActions({
  project,
  workItemType,
  states,
  workItemId,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
  onTypeChange,
}: UseWorkItemActionsOptions): WorkItemActions {
  // State dropdown
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);
  const [availableStates, setAvailableStates] = useState<WorkItemState[]>([]);
  const [isLoadingStates, setIsLoadingStates] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);

  // Assignee dropdown
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);

  // Priority dropdown
  const [isPriorityDropdownOpen, setIsPriorityDropdownOpen] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);

  // Type dropdown
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [availableTypes, setAvailableTypes] = useState<WorkItemType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [isUpdatingType, setIsUpdatingType] = useState(false);
  const typesProjectRef = useRef<string | undefined>(undefined);

  // Pending type change (required fields)
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    type: string;
    requiredFields: RequiredField[];
  } | null>(null);
  const [isLoadingRequiredFields, setIsLoadingRequiredFields] = useState(false);
  const [pendingTypeFieldValues, setPendingTypeFieldValues] = useState<Record<string, string>>({});
  /**
   * People for an identity picker, with the project they came from.
   *
   * Keyed rather than cleared on change: clearing happened in an effect, which
   * still left a request already in flight free to land afterwards and write
   * one project's people into another project's picker. An identity from the
   * wrong project does not resolve, so the update fails after the pick
   * (raised in review on #652). Holding the project with the list makes a
   * stale answer unusable instead of merely unlikely.
   */
  const [loadedMembers, setLoadedMembers] = useState<{ project: string; members: User[] }>({
    project: '',
    members: [],
  });
  const [isLoadingRequiredFieldMembers, setIsLoadingRequiredFieldMembers] = useState(false);
  const requiredFieldMembers = useMemo(
    () => (loadedMembers.project === (project ?? '') ? loadedMembers.members : []),
    [loadedMembers, project]
  );
  /** Counts state selections, so only the newest one may act on its answer. */
  const stateSelectionRef = useRef(0);
  const [pendingTypeMemberSearch, setPendingTypeMemberSearch] = useState('');
  // The same shape for a state change (#651). Separate state rather than one
  // shared pending-change object: both dialogs can be reached from the same
  // screen, and sharing would let one cancel the other's half-filled form.
  const [pendingStateChange, setPendingStateChange] = useState<{
    /**
     * The item this prompt is for. The dialog renders outside the shell, so
     * closing it and opening another ticket left the prompt standing:
     * confirming then sent one ticket's state and fields to a different one
     * (raised in review on #652).
     */
    workItemId: number;
    state: string;
    requiredFields: RequiredField[];
  } | null>(null);
  const [pendingStateFieldValues, setPendingStateFieldValues] = useState<Record<string, string>>(
    {}
  );
  const [pendingStateMemberSearch, setPendingStateMemberSearch] = useState('');

  const { get: devOpsGet } = useDevOpsApi();

  // Fetch available states when dropdown opens
  useEffect(() => {
    if (states) return;
    if (isStateDropdownOpen && availableStates.length === 0) {
      const fetchStates = async () => {
        setIsLoadingStates(true);
        try {
          const params = new URLSearchParams();
          if (workItemType) params.set('type', workItemType);
          if (project) params.set('project', project);
          const query = params.toString();
          const response = await devOpsGet(
            `/api/devops/workitem-states${query ? `?${query}` : ''}`
          );
          if (response.ok) {
            const data = await response.json();
            setAvailableStates(ensureActiveState(data.allStates || []));
          }
        } catch (err) {
          console.error('Failed to fetch work item states:', err);
        } finally {
          setIsLoadingStates(false);
        }
      };
      fetchStates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStateDropdownOpen, states]);

  // Fetch team members when assignee dropdown opens.
  // Use devOpsGet (not bare fetch) so the x-devops-org header is included —
  // otherwise the route falls back to the default org and lists the wrong
  // people, and any assignee picked from that list is an identity DevOps
  // can't resolve in the *actual* selected org (silent no-op on PATCH).
  useEffect(() => {
    if (isAssigneeDropdownOpen && teamMembers.length === 0 && project) {
      const fetchMembers = async () => {
        setIsLoadingMembers(true);
        try {
          const response = await devOpsGet(
            `/api/devops/projects/${encodeURIComponent(project)}/members`
          );
          if (response.ok) {
            const data = await response.json();
            setTeamMembers(data.members || []);
          }
        } catch (err) {
          console.error('Failed to fetch team members:', err);
        } finally {
          setIsLoadingMembers(false);
        }
      };
      fetchMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssigneeDropdownOpen, project]);

  // Filter members: exclude stakeholders, apply search
  const filteredMembers = useMemo(
    () => matchingMembers(teamMembers, assigneeSearch),
    [teamMembers, assigneeSearch]
  );

  // Filter members for pending type change (people picker fields like Found By)
  const filteredPendingTypeMembers = useMemo(
    () => matchingMembers(requiredFieldMembers, pendingTypeMemberSearch),
    [requiredFieldMembers, pendingTypeMemberSearch]
  );

  // The same list, searched separately: the state dialog and the type dialog
  // each have their own search box (#651).
  const filteredPendingStateMembers = useMemo(
    () => matchingMembers(requiredFieldMembers, pendingStateMemberSearch),
    [requiredFieldMembers, pendingStateMemberSearch]
  );

  const setPendingTypeFieldValue = useCallback((fieldRef: string, value: string) => {
    setPendingTypeFieldValues((prev) => ({ ...prev, [fieldRef]: value }));
  }, []);

  const cancelPendingTypeChange = useCallback(() => {
    setPendingTypeChange(null);
    setPendingTypeFieldValues({});
    setPendingTypeMemberSearch('');
  }, []);

  const confirmPendingTypeChange = useCallback(async () => {
    if (!pendingTypeChange || !onTypeChange) return;
    setIsUpdatingType(true);
    try {
      await onTypeChange(pendingTypeChange.type, pendingTypeFieldValues);
      setPendingTypeChange(null);
      setPendingTypeFieldValues({});
      setPendingTypeMemberSearch('');
      setIsTypeDropdownOpen(false);
    } finally {
      setIsUpdatingType(false);
    }
  }, [pendingTypeChange, pendingTypeFieldValues, onTypeChange]);

  /**
   * Move to `state`, asking first for anything the process will demand.
   *
   * A rule can make a field required only on certain transitions -- "any state
   * other than New requires Approved By and Approved Date" -- and the update
   * has to carry those values in the same revision. Sending the state alone
   * had the rule reject it, so the ticket silently stayed where it was (#651).
   *
   * When the rules cannot be read -- they need a permission not every user has
   * -- the transition is attempted anyway and whatever the server says about
   * it is what the user sees. Refusing to try would block transitions that are
   * perfectly allowed.
   */
  /**
   * People for an identity field's picker, loaded once per project.
   *
   * The dialog shows "Loading..." while this runs and says plainly when it
   * finishes with nobody, rather than showing a spinner for ever on a request
   * that already failed (raised in review on #652).
   */
  const loadRequiredFieldMembers = useCallback(async () => {
    if (!project) return;
    const forProject = project;
    setIsLoadingRequiredFieldMembers(true);
    try {
      const response = await devOpsGet(
        `/api/devops/projects/${encodeURIComponent(forProject)}/members`,
        // Neither this helper nor the members route bounds the wait, and the
        // picker shows "Loading..." until it settles.
        { signal: AbortSignal.timeout(MEMBERS_TIMEOUT_MS) }
      );
      if (response.ok) {
        const data = await response.json();
        setLoadedMembers({ project: forProject, members: data.members || [] });
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      setIsLoadingRequiredFieldMembers(false);
    }
  }, [project, devOpsGet]);

  const handleStateSelect = useCallback(
    async (state: string) => {
      if (!onStateChange) return;

      if (workItemId && project) {
        // Only the newest selection may act. The options stay clickable while
        // this runs, and two lookups can finish in either order -- an older
        // one could otherwise replace the newer one's prompt, or move the
        // ticket while that prompt was open (raised in review on #652).
        const selection = ++stateSelectionRef.current;
        setIsLoadingRequiredFields(true);
        try {
          const fields = await fetchStateRequirements(devOpsGet, workItemId, project, state);
          if (selection !== stateSelectionRef.current) return;
          if (fields.length > 0) {
            setIsStateDropdownOpen(false);
            setPendingStateChange({ workItemId, state, requiredFields: fields });
            setPendingStateFieldValues({});
            setPendingStateMemberSearch('');
            if (fields.some((f) => f.isIdentity)) await loadRequiredFieldMembers();
            return;
          }
        } finally {
          // Left alone when a newer selection has taken over: it owns the flag
          // and is still running.
          if (selection === stateSelectionRef.current) setIsLoadingRequiredFields(false);
        }
      }

      setIsUpdatingState(true);
      try {
        await onStateChange(state);
        setIsStateDropdownOpen(false);
      } finally {
        setIsUpdatingState(false);
      }
    },
    [onStateChange, workItemId, project, devOpsGet, loadRequiredFieldMembers]
  );

  const setPendingStateFieldValue = useCallback((fieldRef: string, value: string) => {
    setPendingStateFieldValues((prev) => ({ ...prev, [fieldRef]: value }));
  }, []);

  const cancelPendingStateChange = useCallback(() => {
    setPendingStateChange(null);
    setPendingStateFieldValues({});
    setPendingStateMemberSearch('');
  }, []);

  const confirmPendingStateChange = useCallback(async () => {
    if (!pendingStateChange || !onStateChange) return;
    // Belt and braces with the clearing below: never apply one item's answer
    // to another.
    if (pendingStateChange.workItemId !== workItemId) {
      setPendingStateChange(null);
      return;
    }
    setIsUpdatingState(true);
    try {
      await onStateChange(pendingStateChange.state, pendingStateFieldValues);
      setPendingStateChange(null);
      setPendingStateFieldValues({});
      setPendingStateMemberSearch('');
      setIsStateDropdownOpen(false);
    } finally {
      setIsUpdatingState(false);
    }
  }, [pendingStateChange, pendingStateFieldValues, onStateChange, workItemId]);

  const handleAssigneeSelect = useCallback(
    async (memberId: string | null) => {
      if (!onAssigneeChange) return;
      setIsUpdatingAssignee(true);
      // Close the dropdown regardless of success/failure so the parent's
      // toast feedback is the user-visible signal, not a stuck dropdown.
      setIsAssigneeDropdownOpen(false);
      setAssigneeSearch('');
      try {
        await onAssigneeChange(memberId);
      } finally {
        setIsUpdatingAssignee(false);
      }
    },
    [onAssigneeChange]
  );

  const handlePrioritySelect = useCallback(
    async (priority: number) => {
      if (!onPriorityChange) return;
      setIsUpdatingPriority(true);
      try {
        await onPriorityChange(priority);
        setIsPriorityDropdownOpen(false);
      } finally {
        setIsUpdatingPriority(false);
      }
    },
    [onPriorityChange]
  );

  // Reset available types when project changes
  useEffect(() => {
    if (project !== typesProjectRef.current) {
      setAvailableTypes([]);
      typesProjectRef.current = project;
    }
  }, [project]);

  // Fetch available types when type dropdown opens
  useEffect(() => {
    if (isTypeDropdownOpen && availableTypes.length === 0 && project) {
      const fetchTypes = async () => {
        setIsLoadingTypes(true);
        try {
          const response = await devOpsGet(
            `/api/devops/projects/${encodeURIComponent(project)}/workitemtypes`
          );
          if (response.ok) {
            const data = await response.json();
            setAvailableTypes(data.types || []);
          }
        } catch (err) {
          console.error('Failed to fetch work item types:', err);
        } finally {
          setIsLoadingTypes(false);
        }
      };
      fetchTypes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTypeDropdownOpen, project]);

  const handleTypeSelect = useCallback(
    async (type: string) => {
      if (!onTypeChange || type === workItemType) {
        setIsTypeDropdownOpen(false);
        return;
      }

      // Check if the target type has required fields
      if (project) {
        setIsLoadingRequiredFields(true);
        setIsTypeDropdownOpen(false);
        try {
          const response = await devOpsGet(
            `/api/devops/projects/${encodeURIComponent(project)}/required-fields?workItemType=${encodeURIComponent(type)}`
          );
          if (response.ok) {
            const data = await response.json();
            const fields: RequiredField[] = data.fields || [];
            if (fields.length > 0) {
              // Has required fields — show the modal
              setPendingTypeChange({ type, requiredFields: fields });
              setPendingTypeFieldValues({});
              setPendingTypeMemberSearch('');

              // Any identity field needs the picker, not just Found By: the
              // endpoint reports `isIdentity` now, and the dialog draws a
              // picker from it. Recognising one field name here left every
              // other identity field with an empty picker and no way to
              // confirm (raised in review on #652). The name check stays for
              // an answer that predates the flag.
              const hasPeopleField = fields.some(
                (f) => f.isIdentity || f.referenceName === 'Custom.FoundBy'
              );
              if (hasPeopleField) await loadRequiredFieldMembers();
              return;
            }
          }
        } catch (err) {
          console.error('Failed to fetch required fields:', err);
        } finally {
          setIsLoadingRequiredFields(false);
        }
      }

      // No required fields — proceed directly
      setIsUpdatingType(true);
      try {
        await onTypeChange(type);
        setIsTypeDropdownOpen(false);
      } finally {
        setIsUpdatingType(false);
      }
    },
    [onTypeChange, workItemType, project, devOpsGet, loadRequiredFieldMembers]
  );

  const resetAll = useCallback(() => {
    setIsStateDropdownOpen(false);
    // Including the state prompt: it renders outside the dialog shell, so a
    // close that left it standing would carry it onto the next ticket
    // (raised in review on #652).
    setPendingStateChange(null);
    setPendingStateFieldValues({});
    setPendingStateMemberSearch('');
    // Any requirements lookup still running belongs to the item being left.
    stateSelectionRef.current += 1;
    setIsAssigneeDropdownOpen(false);
    setIsPriorityDropdownOpen(false);
    setIsTypeDropdownOpen(false);
    setAssigneeSearch('');
    setPendingTypeChange(null);
    setPendingTypeFieldValues({});
    setPendingTypeMemberSearch('');
  }, []);

  const resetStates = useCallback(() => {
    setAvailableStates([]);
  }, []);

  return {
    isStateDropdownOpen,
    setIsStateDropdownOpen,
    availableStates: states ?? availableStates,
    isLoadingStates,
    isUpdatingState,
    handleStateSelect,

    isAssigneeDropdownOpen,
    setIsAssigneeDropdownOpen,
    assigneeSearch,
    setAssigneeSearch,
    filteredMembers,
    isLoadingMembers,
    isUpdatingAssignee,
    handleAssigneeSelect,

    isPriorityDropdownOpen,
    setIsPriorityDropdownOpen,
    isUpdatingPriority,
    handlePrioritySelect,

    isTypeDropdownOpen,
    setIsTypeDropdownOpen,
    availableTypes,
    isLoadingTypes,
    isUpdatingType,
    handleTypeSelect,

    pendingTypeChange,
    isLoadingRequiredFields,
    pendingTypeFieldValues,
    setPendingTypeFieldValue,
    confirmPendingTypeChange,
    cancelPendingTypeChange,
    requiredFieldMembers,
    isLoadingRequiredFieldMembers,
    pendingTypeMemberSearch,
    setPendingTypeMemberSearch,
    filteredPendingTypeMembers,

    pendingStateChange,
    pendingStateFieldValues,
    setPendingStateFieldValue,
    confirmPendingStateChange,
    cancelPendingStateChange,
    pendingStateMemberSearch,
    setPendingStateMemberSearch,
    filteredPendingStateMembers,

    resetAll,
    resetStates,
  };
}
