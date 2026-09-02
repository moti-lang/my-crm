import type { ReactNode } from 'react';
import { humanError, logError } from '@/lib/errors';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-field bg-shade ${className}`} aria-hidden />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card p-4 space-y-3" role="status" aria-label="טוען">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-soft">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  logError('ErrorState', error);
  const message = humanError(error);
  return (
    <div className="card border-bad/40 p-6 text-center" role="alert">
      <p className="font-display text-lg text-bad">לא הצלחנו לטעון</p>
      <p className="mt-1 text-sm text-soft">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-4" onClick={onRetry}>
          נסי שוב
        </button>
      )}
    </div>
  );
}
