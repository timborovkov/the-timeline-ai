import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function ObjectDetailLoading() {
  return (
    <div className="space-y-10">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <CardSkeleton />
    </div>
  );
}
