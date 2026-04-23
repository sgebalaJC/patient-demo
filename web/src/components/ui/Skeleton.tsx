import React from 'react';
import { Card } from './Card';

interface SkeletonProps {
  className?: string;
}

/**
 * Single shimmer block. Compose these to match the real layout shape so the
 * page doesn't jump on first paint.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`animate-pulse bg-secondary-200 rounded ${className}`} />
);

interface SkeletonListProps {
  /** Number of rows to render. */
  rows?: number;
  /** Optional leading block (title/avatar). Defaults to a small square. */
  leading?: 'avatar' | 'icon' | 'none';
}

/** A card with N skeleton rows — drop-in replacement for list loading states. */
export const SkeletonList: React.FC<SkeletonListProps> = ({ rows = 3, leading = 'icon' }) => {
  return (
    <Card className="p-4 space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center space-x-3">
          {leading === 'avatar' && <Skeleton className="h-10 w-10 rounded-full" />}
          {leading === 'icon' && <Skeleton className="h-8 w-8 rounded-md" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Card>
  );
};
