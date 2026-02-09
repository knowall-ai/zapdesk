'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { User, WorkItemState } from '@/types';
import { ensureActiveState } from '@/types';

interface UseWorkItemActionsOptions {
  project?: string;
  workItemType?: string;
  onStateChange?: (state: string) => Promise<void>;
  onAssigneeChange?: (assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (priority: number) => Promise<void>;
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

  // Reset all dropdowns
  resetAll: () => void;
  // Reset available states (for when work item type changes)
  resetStates: () => void;
}

export function useWorkItemActions({
  project,
  workItemType,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
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

  // Fetch available states when dropdown opens
  useEffect(() => {
    if (isStateDropdownOpen && availableStates.length === 0) {
      const fetchStates = async () => {
        setIsLoadingStates(true);
        try {
          const params = new URLSearchParams();
          if (workItemType) params.set('type', workItemType);
          if (project) params.set('project', project);
          const query = params.toString();
          const response = await fetch(`/api/devops/workitem-states${query ? `?${query}` : ''}`);
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
  }, [isStateDropdownOpen]);

  // Fetch team members when assignee dropdown opens
  useEffect(() => {
    if (isAssigneeDropdownOpen && teamMembers.length === 0 && project) {
      const fetchMembers = async () => {
        setIsLoadingMembers(true);
        try {
          const response = await fetch(
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
  const filteredMembers = useMemo(() => {
    return teamMembers
      .filter((member) => {
        const isStakeholder =
          member.accessLevel?.toLowerCase().includes('stakeholder') ||
          member.licenseType?.toLowerCase().includes('stakeholder');
        return !isStakeholder;
      })
      .filter((member) => {
        if (!assigneeSearch) return true;
        const search = assigneeSearch.toLowerCase();
        return (
          member.displayName.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [teamMembers, assigneeSearch]);

  const handleStateSelect = useCallback(
    async (state: string) => {
      if (!onStateChange) return;
      setIsUpdatingState(true);
      try {
        await onStateChange(state);
        setIsStateDropdownOpen(false);
      } finally {
        setIsUpdatingState(false);
      }
    },
    [onStateChange]
  );

  const handleAssigneeSelect = useCallback(
    async (memberId: string | null) => {
      if (!onAssigneeChange) return;
      setIsUpdatingAssignee(true);
      try {
        await onAssigneeChange(memberId);
        setIsAssigneeDropdownOpen(false);
        setAssigneeSearch('');
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

  const resetAll = useCallback(() => {
    setIsStateDropdownOpen(false);
    setIsAssigneeDropdownOpen(false);
    setIsPriorityDropdownOpen(false);
    setAssigneeSearch('');
  }, []);

  const resetStates = useCallback(() => {
    setAvailableStates([]);
  }, []);

  return {
    isStateDropdownOpen,
    setIsStateDropdownOpen,
    availableStates,
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

    resetAll,
    resetStates,
  };
}
