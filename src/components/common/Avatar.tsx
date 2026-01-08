'use client';

import Image from 'next/image';

interface AvatarProps {
  name: string;
  image?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorFromName(name: string): string {
  const colors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#ec4899',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

const imageSizes = {
  sm: 24,
  md: 32,
  lg: 40,
};

export default function Avatar({ name, image, size = 'md', className = '' }: AvatarProps) {
  if (image) {
    return (
      <Image
        src={image}
        alt={name}
        width={imageSizes[size]}
        height={imageSizes[size]}
        className={`${sizeClasses[size]} rounded-full object-cover ${className}`}
        unoptimized
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} flex items-center justify-center rounded-full font-medium text-white ${className}`}
      style={{ backgroundColor: getColorFromName(name) }}
    >
      {getInitials(name)}
    </div>
  );
}
