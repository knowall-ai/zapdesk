import { SOURCE_COLORS, SOURCE_LABELS, type SourceKind } from '@/lib/source-colors';

interface SourceLegendProps {
  /**
   * Which sources are actually on the board. Renders nothing for fewer than
   * two: with only one source there is nothing to tell apart, and a legend
   * explaining a distinction nobody can see is just noise.
   */
  sources: readonly SourceKind[];
  className?: string;
}

/**
 * Says what the colour down a card's left edge means (#465).
 *
 * Each swatch carries its name, because a swatch on its own explains nothing —
 * the reader is left to guess which colour is which product.
 */
export default function SourceLegend({ sources, className = '' }: SourceLegendProps) {
  const shown = (['devops', 'github'] as const).filter((kind) => sources.includes(kind));
  if (shown.length < 2) return null;
  return (
    <ul className={`flex items-center gap-3 ${className}`} aria-label="Card source colours">
      {shown.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span
            className="inline-block h-3 w-1 rounded-sm"
            style={{ backgroundColor: SOURCE_COLORS[kind] }}
            aria-hidden="true"
          />
          {SOURCE_LABELS[kind]}
        </li>
      ))}
    </ul>
  );
}
