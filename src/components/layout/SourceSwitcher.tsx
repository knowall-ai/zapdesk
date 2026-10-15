'use client';

import { Github, Layers, SquareKanban } from 'lucide-react';
import { useSourceFilter } from '@/components/providers/SourceProvider';
import type { SourceFilter } from '@/types';

const OPTIONS: { value: SourceFilter; label: string; title: string; Icon: typeof Layers }[] = [
  { value: 'both', label: 'Both', title: 'Show Azure DevOps and GitHub together', Icon: Layers },
  {
    value: 'devops',
    label: 'DevOps',
    title: 'Show Azure DevOps work items only',
    Icon: SquareKanban,
  },
  { value: 'github', label: 'GitHub', title: 'Show GitHub issues only', Icon: Github },
];

/**
 * Chooses which sources the work lists show (#447). Renders nothing until the
 * server reports GitHub is set up, so a DevOps-only deployment looks unchanged.
 */
export default function SourceSwitcher() {
  const { gitHubConfigured, sourceFilter, setSourceFilter } = useSourceFilter();

  if (!gitHubConfigured) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Work item source"
      className="flex items-center gap-1 rounded-lg bg-[var(--background)] p-1"
    >
      {OPTIONS.map(({ value, label, title, Icon }) => {
        const selected = sourceFilter === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={title}
            title={title}
            onClick={() => setSourceFilter(value)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors ${
              selected
                ? 'bg-[var(--primary)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={14} />
            <span className="hidden lg:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
