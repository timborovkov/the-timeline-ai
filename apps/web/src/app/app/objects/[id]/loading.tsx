import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { NarrowContainer } from '@/components/narrow-container';

export default function ObjectDetailLoading() {
  return (
    <NarrowContainer>
      <div className="space-y-10">
        <PageHeaderSkeleton />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    </NarrowContainer>
  );
}
