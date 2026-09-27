import type { ReactNode } from 'react';

interface TreeToolbarProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function TreeToolbar({ title, children, className = '' }: TreeToolbarProps) {
  return (
    <div className={`flex min-w-0 flex-col items-stretch gap-2 px-4 py-2 bg-app-card border-b border-app-border sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="min-w-0 truncate text-sm text-app-text-muted" title={title}>
        {title}
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:w-auto sm:flex-nowrap sm:shrink-0">
        {children}
      </div>
    </div>
  );
}
