import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function ObjectDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
