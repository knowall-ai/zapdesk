'use client';

import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  className?: string;
}

const sizeMap = {
  sm: 16,
  md: 24,
  lg: 32,
};

export default function LoadingSpinner({
  size = 'md',
  message,
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <Loader2 size={sizeMap[size]} className="animate-spin" style={{ color: 'var(--primary)' }} />
      {message && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {message}
        </p>
      )}
    </div>
  );
}
