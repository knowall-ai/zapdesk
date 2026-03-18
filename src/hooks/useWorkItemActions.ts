'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { User, WorkItemState, WorkItemType } from '@/types';
import { ensureActiveState } from '@/types';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';

export interface RequiredField {
  referenceName: string;
  name: string;
  type: string;
  allowedValues?: string[];
}

interface UseWorkItemActionsOptions {
  project?: string;
  workItemType?: string;
  onStateChange?: (state: string) => Promise<void>;
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
  pendingTypeMembers: User[];
  pendingTypeMemberSearch: string;
  setPendingTypeMemberSearch: (search: string) => void;
  filteredPendingTypeMembers: User[];

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
  const [pendingTypeMembers, setPendingTypeMembers] = useState<User[]>([]);
  const [pendingTypeMemberSearch, setPendingTypeMemberSearch] = useState('');

  const { get: devOpsGet } = useDevOpsApi();

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

  // Filter members for pending type change (people picker fields like Found By)
  const filteredPendingTypeMembers = useMemo(() => {
    return pendingTypeMembers
      .filter((member) => {
        const isStakeholder =
          member.accessLevel?.toLowerCase().includes('stakeholder') ||
          member.licenseType?.toLowerCase().includes('stakeholder');
        return !isStakeholder;
      })
      .filter((member) => {
        if (!pendingTypeMemberSearch) return true;
        const search = pendingTypeMemberSearch.toLowerCase();
        return (
          member.displayName.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [pendingTypeMembers, pendingTypeMemberSearch]);

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

              // Pre-fetch team members for people picker fields (e.g., Found By)
              const hasPeopleField = fields.some((f) => f.referenceName === 'Custom.FoundBy');
              if (hasPeopleField && pendingTypeMembers.length === 0) {
                try {
                  const membersResponse = await devOpsGet(
                    `/api/devops/projects/${encodeURIComponent(project)}/members`
                  );
                  if (membersResponse.ok) {
                    const membersData = await membersResponse.json();
                    setPendingTypeMembers(membersData.members || []);
                  }
                } catch (err) {
                  console.error('Failed to fetch members for type change:', err);
                }
              }
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
    [onTypeChange, workItemType, project, devOpsGet, pendingTypeMembers.length]
  );

  const resetAll = useCallback(() => {
    setIsStateDropdownOpen(false);
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
    pendingTypeMembers,
    pendingTypeMemberSearch,
    setPendingTypeMemberSearch,
    filteredPendingTypeMembers,

    resetAll,
    resetStates,
  };
}
