'use client';

import type { TicketSLAInfo, SLALevel, SLAStatus } from '@/types';
import { formatDuration, getSLAStatusLabel } from '@/lib/sla';

interface SLABadgeProps {
  slaInfo?: TicketSLAInfo;
  variant?: 'compact' | 'full';
  showLevel?: boolean;
}

interface SLALevelBadgeProps {
  level: SLALevel;
  size?: 'sm' | 'md';
}

const statusIcons: Record<SLAStatus, string> = {
  within_sla: '',
  at_risk: '',
  breached: '',
};

const levelClasses: Record<SLALevel, string> = {
  Gold: 'sla-level-gold',
  Silver: 'sla-level-silver',
  Bronze: 'sla-level-bronze',
};

export function SLALevelBadge({ level, size = 'md' }: SLALevelBadgeProps) {
  return (
    <span
      className={`sla-badge ${levelClasses[level]} ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : ''
      }`}
    >
      {level}
    </span>
  );
}

export default function SLABadge({
  slaInfo,
  variant = 'compact',
  showLevel = false,
}: SLABadgeProps) {
  if (!slaInfo) {
    return null;
  }

  // Get the most critical status between first response and resolution
  const getOverallStatus = (): SLAStatus => {
    const statuses = [slaInfo.firstResponse.status, slaInfo.resolution.status];

    if (statuses.includes('breached')) return 'breached';
    if (statuses.includes('at_risk')) return 'at_risk';
    return 'within_sla';
  };

  const overallStatus = getOverallStatus();
  const statusClass =
    overallStatus === 'within_sla'
      ? 'sla-within'
      : overallStatus === 'at_risk'
        ? 'sla-at-risk'
        : 'sla-breached';

  // For compact view, show the most urgent time remaining
  const getCompactDisplay = () => {
    // If first response hasn't been met, show that time
    if (!slaInfo.firstResponse.met) {
      const remaining = slaInfo.firstResponse.remainingMinutes;
      if (remaining <= 0) {
        return 'Response overdue';
      }
      return `Response: ${formatDuration(remaining)}`;
    }

    // If resolution hasn't been met, show that time
    if (!slaInfo.resolution.met) {
      const remaining = slaInfo.resolution.remainingMinutes;
      if (remaining <= 0) {
        return 'Resolution overdue';
      }
      return `Resolution: ${formatDuration(remaining)}`;
    }

    // Both met
    return 'SLA Met';
  };

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        {showLevel && <SLALevelBadge level={slaInfo.level} size="sm" />}
        <span className={`sla-badge ${statusClass}`}>
          {statusIcons[overallStatus]}
          {getCompactDisplay()}
        </span>
      </div>
    );
  }

  // Full variant with both first response and resolution times
  return (
    <div className="space-y-2">
      {showLevel && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">SLA Level:</span>
          <SLALevelBadge level={slaInfo.level} />
        </div>
      )}

      <div className="space-y-1">
        {/* First Response */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">First Response:</span>
          <span
            className={`sla-badge ${
              slaInfo.firstResponse.status === 'within_sla'
                ? 'sla-within'
                : slaInfo.firstResponse.status === 'at_risk'
                  ? 'sla-at-risk'
                  : 'sla-breached'
            }`}
          >
            {slaInfo.firstResponse.met
              ? `Met (${formatDuration(slaInfo.firstResponse.elapsedMinutes)})`
              : slaInfo.firstResponse.remainingMinutes > 0
                ? formatDuration(slaInfo.firstResponse.remainingMinutes)
                : 'Overdue'}
          </span>
        </div>

        {/* Resolution */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Resolution:</span>
          <span
            className={`sla-badge ${
              slaInfo.resolution.status === 'within_sla'
                ? 'sla-within'
                : slaInfo.resolution.status === 'at_risk'
                  ? 'sla-at-risk'
                  : 'sla-breached'
            }`}
          >
            {slaInfo.resolution.met
              ? `Met (${formatDuration(slaInfo.resolution.elapsedMinutes)})`
              : slaInfo.resolution.remainingMinutes > 0
                ? formatDuration(slaInfo.resolution.remainingMinutes)
                : 'Overdue'}
          </span>
        </div>
      </div>

      {/* SLA Target Info */}
      <div className="border-t border-gray-700 pt-1 text-[10px] text-gray-600">
        Target: {formatDuration(slaInfo.firstResponse.targetMinutes)} response /{' '}
        {formatDuration(slaInfo.resolution.targetMinutes)} resolution
      </div>
    </div>
  );
}

// Export a simple status indicator for use in lists
export function SLAStatusIndicator({ slaInfo }: { slaInfo?: TicketSLAInfo }) {
  if (!slaInfo) return null;

  const getOverallStatus = (): SLAStatus => {
    const statuses = [slaInfo.firstResponse.status, slaInfo.resolution.status];
    if (statuses.includes('breached')) return 'breached';
    if (statuses.includes('at_risk')) return 'at_risk';
    return 'within_sla';
  };

  const status = getOverallStatus();
  const colorClass =
    status === 'within_sla'
      ? 'bg-green-500'
      : status === 'at_risk'
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorClass}`}
      title={getSLAStatusLabel(status)}
    />
  );
}
