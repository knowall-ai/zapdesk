import type { WorkItemType } from '@/types';

/**
 * A work item type, shown the same way wherever it appears.
 *
 * The colour and icon come from Azure DevOps rather than a table of our own,
 * which is what #7390 asked for: a type added or recoloured in DevOps follows
 * here with no code change, and ZapDesk looks like the board people already
 * know.
 *
 * It exists because the same type looked different depending on the screen --
 * coloured with an icon on the board and in kanban cards, plain text in all
 * three detail views. Two renderings of one fact read as two products, which is
 * the complaint behind "different visualisations".
 *
 * Falls back to the bare name when DevOps gives no colour or icon, so a type we
 * know nothing about still renders rather than vanishing.
 */
export default function WorkItemTypeBadge({
  type,
  typeInfo,
  className = '',
}: {
  type: string | undefined;
  typeInfo?: Pick<WorkItemType, 'color' | 'icon'>;
  className?: string;
}) {
  if (!type) return null;

  const color = typeInfo?.color ? `#${typeInfo.color}` : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: 'var(--surface-hover)',
        color: 'var(--text-secondary)',
        borderLeft: color ? `3px solid ${color}` : undefined,
      }}
    >
      {typeInfo?.icon && (
        // A DevOps-hosted icon URL, not an asset next/image can route.
        <img src={typeInfo.icon} alt="" className="h-3.5 w-3.5" />
      )}
      {type}
    </span>
  );
}
