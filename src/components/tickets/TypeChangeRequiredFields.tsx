'use client';

import { X, Loader2, Search } from 'lucide-react';
import type { RequiredField } from '@/hooks/useWorkItemActions';
import type { User } from '@/types';

interface TypeChangeRequiredFieldsProps {
  targetType: string;
  requiredFields: RequiredField[];
  fieldValues: Record<string, string>;
  onFieldChange: (fieldRef: string, value: string) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isUpdating: boolean;
  // People picker support
  members: User[];
  memberSearch: string;
  onMemberSearchChange: (search: string) => void;
  filteredMembers: User[];
}

const PEOPLE_PICKER_FIELDS = new Set(['Custom.FoundBy']);

// Build full identity string for Azure DevOps: "DisplayName <email>"
const buildIdentityString = (member: User): string => {
  if (member.email) {
    return `${member.displayName} <${member.email}>`;
  }
  return member.displayName;
};

// Extract display name from identity string "DisplayName <email>"
const getDisplayNameFromIdentity = (identity: string): string => {
  if (!identity) return '';
  const match = identity.match(/^(.+?)\s*<.+>$/);
  return match ? match[1].trim() : identity;
};

export default function TypeChangeRequiredFields({
  targetType,
  requiredFields,
  fieldValues,
  onFieldChange,
  onConfirm,
  onCancel,
  isUpdating,
  members,
  memberSearch,
  onMemberSearchChange,
  filteredMembers,
}: TypeChangeRequiredFieldsProps) {
  const allFieldsFilled = requiredFields.every((f) => {
    const value = fieldValues[f.referenceName];
    return !!value;
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div
        className="mx-4 w-full max-w-md rounded-lg shadow-xl"
        style={{ backgroundColor: 'var(--background)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Change to {targetType}
          </h3>
          <button
            onClick={onCancel}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            The following fields are required for {targetType} work items:
          </p>

          {requiredFields.map((field) => {
            const isPeoplePicker = PEOPLE_PICKER_FIELDS.has(field.referenceName);

            if (isPeoplePicker) {
              const selectedValue = fieldValues[field.referenceName];
              return (
                <div key={field.referenceName}>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {field.name} *
                  </label>
                  {members.length === 0 ? (
                    <div
                      className="flex items-center gap-2 text-sm"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Loader2 className="animate-spin" size={14} />
                      Loading...
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Search input */}
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute top-1/2 left-2 -translate-y-1/2"
                          style={{ color: 'var(--text-muted)' }}
                        />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={memberSearch}
                          onChange={(e) => onMemberSearchChange(e.target.value)}
                          className="input w-full pl-7 text-sm"
                        />
                      </div>
                      {/* Selected user or member list */}
                      {selectedValue && selectedValue.trim() ? (
                        <div
                          className="flex items-center justify-between rounded p-2"
                          style={{ backgroundColor: 'var(--surface-hover)' }}
                        >
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                            {getDisplayNameFromIdentity(selectedValue)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onFieldChange(field.referenceName, '');
                              onMemberSearchChange('');
                            }}
                            className="text-xs hover:underline"
                            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            clear
                          </button>
                        </div>
                      ) : (
                        <div
                          className="max-h-32 overflow-auto rounded"
                          style={{ border: '1px solid var(--border)' }}
                        >
                          {filteredMembers.length === 0 ? (
                            <p
                              className="p-2 text-center text-xs"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              No users found
                            </p>
                          ) : (
                            filteredMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => {
                                  onFieldChange(field.referenceName, buildIdentityString(member));
                                  onMemberSearchChange('');
                                }}
                                className="block w-full px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                                style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                              >
                                {member.displayName}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            // Dropdown for fields with allowed values
            if (field.allowedValues && field.allowedValues.length > 0) {
              return (
                <div key={field.referenceName}>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {field.name} *
                  </label>
                  <select
                    value={fieldValues[field.referenceName] || ''}
                    onChange={(e) => onFieldChange(field.referenceName, e.target.value)}
                    className="input w-full text-sm"
                  >
                    <option value="">Select {field.name}...</option>
                    {field.allowedValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Text input fallback
            return (
              <div key={field.referenceName}>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {field.name} *
                </label>
                <input
                  type="text"
                  value={fieldValues[field.referenceName] || ''}
                  onChange={(e) => onFieldChange(field.referenceName, e.target.value)}
                  placeholder={`Enter ${field.name}...`}
                  className="input w-full text-sm"
                />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!allFieldsFilled || isUpdating}
            className="btn-primary rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            {isUpdating ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Changing...
              </span>
            ) : (
              `Change to ${targetType}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
