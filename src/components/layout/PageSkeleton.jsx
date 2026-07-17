import { Skeleton } from '@/components/ui/skeleton';

// Generic page-shaped skeleton used as the Suspense fallback while a lazy
// route chunk loads, and by pages that have no cached data yet. Mirrors the
// app's usual layout (title line + stacked cards) so the swap feels seamless.
export function PageSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <Skeleton className="h-5 w-56 mb-6" />
      <Skeleton className="h-36 rounded-2xl mb-5" />
      <Skeleton className="h-16 rounded-2xl mb-5" />
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    </div>
  );
}

// Closer mirror of the Home layout (schedule + bonus banner + person cards).
export function HomeSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <Skeleton className="h-5 w-64 mb-6" />
      <div className="mb-6">
        <Skeleton className="h-4 w-44 mb-3" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="h-16 rounded-2xl mb-5" />
      <div className="space-y-3 mb-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-5 w-40 mb-3" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}
