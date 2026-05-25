import { EntityGridSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function ObjectsLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <EntityGridSkeleton count={8} />
    </div>
  );
}
