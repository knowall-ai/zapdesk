'use client';

import { useState } from 'react';
import { X, Loader2, Search, ChevronDown } from 'lucide-react';
import type { RequiredField } from '@/hooks/useWorkItemActions';
import type { User } from '@/types';
import Avatar from '../common/Avatar';

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
  const [openPeoplePicker, setOpenPeoplePicker] = useState<string | null>(null);

  const allFieldsFilled = requiredFields.every((f) => {
    const value = fieldValues[f.referenceName];
    if (!value) {
      // If field has allowed values and a default exists, it's optional
      return false;
    }
    return true;
  });

  const handleMemberSelect = (fieldRef: string, member: User) => {
    onFieldChange(fieldRef, member.displayName);
    setOpenPeoplePicker(null);
    onMemberSearchChange('');
  };

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
              return (
                <div key={field.referenceName} className="relative">
                  <label
                    className="mb-1 block text-sm font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {field.name}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPeoplePicker(
                        openPeoplePicker === field.referenceName ? null : field.referenceName
                      )
                    }
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
                    style={{
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--surface)',
                      color: fieldValues[field.referenceName]
                        ? 'var(--text-primary)'
                        : 'var(--text-muted)',
                    }}
                  >
                    <span>{fieldValues[field.referenceName] || `Select ${field.name}...`}</span>
                    <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>

                  {openPeoplePicker === field.referenceName && (
                    <div
                      className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
                      style={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
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
                            placeholder="Search users..."
                            value={memberSearch}
                            onChange={(e) => onMemberSearchChange(e.target.value)}
                            className="input w-full pl-7 text-sm"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="max-h-48 overflow-auto">
                        {members.length === 0 ? (
                          <div
                            className="flex items-center justify-center gap-2 p-3"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <Loader2 size={14} className="animate-spin" />
                            Loading...
                          </div>
                        ) : (
                          filteredMembers.map((member) => (
                            <button
                              key={member.id}
                              onClick={() => handleMemberSelect(field.referenceName, member)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                              style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                            >
                              <Avatar
                                name={member.displayName}
                                image={member.avatarUrl}
                                size="sm"
                              />
                              {member.displayName}
                            </button>
                          ))
                        )}
                      </div>
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
                    className="mb-1 block text-sm font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {field.name}
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
                  className="mb-1 block text-sm font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {field.name}
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
