'use client';

import { useId } from 'react';

interface ZapDeskIconProps {
  size?: number;
  className?: string;
}

/**
 * ZapDesk Logo Icon
 *
 * A lightning bolt symbolizing speed and energy.
 * An ink bolt on a rounded tile in the KnowAll luminous green (--color-brand).
 */
export default function ZapDeskIcon({ size = 32, className = '' }: ZapDeskIconProps) {
  const id = useId();
  const shineGradientId = `zapdesk-shine-${id}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-label="ZapDesk"
    >
      <defs>
        {/* Subtle shine for 3D effect */}
        <linearGradient id={shineGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Background with rounded corners */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill="var(--color-brand)" />

      {/* Subtle shine overlay */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill={`url(#${shineGradientId})`} />

      {/* Lightning bolt - scaled from 512x512 to 64x64 (divide by 8) */}
      <polygon
        points="37,5 17,35.5 29.5,35.5 24.5,59 47,28 34.5,28"
        fill="var(--color-brand-foreground)"
      />
    </svg>
  );
}
