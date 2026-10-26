'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, Timer, X } from 'lucide-react';
import { effortChanges, parseHours } from '@/lib/effort-edit';
import type { EffortHoursUpdate } from '@/types';

interface EffortHoursFieldProps {
  completedWork?: number;
  remainingWork?: number;
  /** Absent: shown read-only. */
  onSave?: (hours: EffortHoursUpdate) => Promise<void>;
}

/** Hours for display: whole numbers as they are, anything else to one decimal. */
function formatHours(value?: number): string {
  const hours = value ?? 0;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * Time spent and time remaining, editable in place (#7728).
 *
 * Both were shown but could only be changed in Azure DevOps.
 */
export default function EffortHoursField({
  completedWork,
  remainingWork,
  onSave,
}: EffortHoursFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [completed, setCompleted] = useState('');
  const [remaining, setRemaining] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    // The exact values, not the rounded display: 1.25 shown as 1.3 would
    // otherwise be saved back as 1.3 when only the other field was edited.
    setCompleted(String(completedWork ?? 0));
    setRemaining(String(remainingWork ?? 0));
    setError(null);
    setIsEditing(true);
  };

  const save = async () => {
    if (!onSave) return;
    const completedHours = parseHours(completed);
    const remainingHours = parseHours(remaining);
    if (completedHours === null || remainingHours === null) {
      setError('Enter hours as a number, 0 or more.');
      return;
    }
    // Only what changed is sent (see effortChanges for why).
    const changes = effortChanges(
      { completedWork: completedHours, remainingWork: remainingHours },
      { completedWork, remainingWork }
    );
    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(changes);
      setIsEditing(false);
    } catch {
      setError('Could not save the hours.');
    } finally {
      setIsSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      // The quick view closes on Escape too; this one only cancels the edit.
      e.preventDefault();
      e.stopPropagation();
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="group flex items-center gap-2">
        <Timer size={14} style={{ color: 'var(--text-muted)' }} />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {formatHours(completedWork)}h completed / {formatHours(remainingWork)}h remaining
        </span>
        {onSave && (
          <button
            type="button"
            onClick={startEditing}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            title="Edit time spent and remaining"
            aria-label="Edit time spent and remaining"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Completed
          <input
            type="text"
            inputMode="decimal"
            value={completed}
            onChange={(e) => setCompleted(e.target.value)}
            onKeyDown={onKeyDown}
            className="input mt-1 w-full py-1 text-sm"
            disabled={isSaving}
            autoFocus
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Remaining
          <input
            type="text"
            inputMode="decimal"
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
            onKeyDown={onKeyDown}
            className="input mt-1 w-full py-1 text-sm"
            disabled={isSaving}
          />
        </label>
      </div>
      {error && (
        <p className="text-xs" style={{ color: '#ef4444' }}>
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="btn-primary flex items-center gap-1 px-2 py-1 text-xs"
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}
