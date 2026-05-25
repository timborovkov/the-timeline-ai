import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function ObjectDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <CardSkeleton />
    </div>
  );
}
