'use client';

interface AzureDevOpsIconProps {
  size?: number;
  className?: string;
}

/**
 * Azure DevOps Logo Icon
 *
 * The official Azure DevOps infinity symbol logo in Azure blue.
 */
export default function AzureDevOpsIcon({ size = 24, className = '' }: AzureDevOpsIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-label="Azure DevOps"
    >
      {/* Azure DevOps infinity-style logo */}
      <path
        d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z"
        fill="#0078d4"
      />
    </svg>
  );
}
