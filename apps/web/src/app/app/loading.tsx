import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function AppLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading workspace
      </output>
      <div
        data-app-width="collection"
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading workspace"
      >
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton variant="collection" />
          <CollectionRowsSkeleton count={5} />
        </div>
      </div>
    </>
  );
}
