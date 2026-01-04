'use client';

interface DevDeskIconProps {
  size?: number;
  className?: string;
}

/**
 * DevDesk Logo Icon
 *
 * A stylized "D" with an arrow/triangle cutout on the left stroke,
 * pointing into the center - suggesting forward movement and direction.
 *
 * The icon features:
 * - Bold geometric "D" letterform
 * - Arrow on left vertical stroke pointing right into the D
 * - Metallic gradient for modern depth
 * - Brand green (#22c55e) as primary color
 */
export default function DevDeskIcon({ size = 32, className = '' }: DevDeskIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-label="DevDesk"
    >
      <defs>
        {/* Gradient for metallic effect */}
        <linearGradient id="devdesk-metal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        {/* Subtle shine for 3D effect */}
        <linearGradient id="devdesk-shine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Background with rounded corners */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill="url(#devdesk-metal)" />

      {/* Subtle shine overlay */}
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill="url(#devdesk-shine)" />

      {/* Stylized "D" with arrow cutout on left stroke */}
      <path
        d="M 14 12
           L 14 26
           L 22 32
           L 14 38
           L 14 52
           L 28 52
           C 48 52 54 42 54 32
           C 54 22 48 12 28 12
           Z

           M 24 20
           L 28 20
           C 42 20 46 26 46 32
           C 46 38 42 44 28 44
           L 24 44
           Z"
        fill="#ffffff"
        fillRule="evenodd"
      />
    </svg>
  );
}
