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
 * Neon green (#B8FF00) bolt on a rounded background.
 */
export default function ZapDeskIcon({ size = 32, className = '' }: ZapDeskIconProps) {
  const id = useId();
  const metalGradientId = `zapdesk-metal-${id}`;
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
        {/* Gradient for metallic effect */}
        <linearGradient id={metalGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        {/* Subtle shine for 3D effect */}
        <linearGradient id={shineGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Background with rounded corners */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill={`url(#${metalGradientId})`} />

      {/* Subtle shine overlay */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill={`url(#${shineGradientId})`} />

      {/* Lightning bolt - scaled from 512x512 to 64x64 (divide by 8) */}
      <polygon points="37,5 17,35.5 29.5,35.5 24.5,59 47,28 34.5,28" fill="#ffffff" />
    </svg>
  );
}
