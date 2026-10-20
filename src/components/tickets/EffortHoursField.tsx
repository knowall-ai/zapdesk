'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, Timer, X } from 'lucide-react';

interface EffortHoursFieldProps {
  completedWork?: number;
  remainingWork?: number;
  /** Absent: shown read-only. */
  onSave?: (hours: { completedWork: number; remainingWork: number }) => Promise<void>;
}

function formatHours(value?: number): string {
  const hours = value ?? 0;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** A non-negative number of hours, or null when the input is not one. */
function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
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
    setCompleted(formatHours(completedWork));
    setRemaining(formatHours(remainingWork));
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
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ completedWork: completedHours, remainingWork: remainingHours });
      setIsEditing(false);
    } catch {
      setError('Could not save the hours.');
    } finally {
      setIsSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setIsEditing(false);
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
            type="number"
            min={0}
            step={0.5}
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
            type="number"
            min={0}
            step={0.5}
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
