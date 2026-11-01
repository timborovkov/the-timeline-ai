import { CollectionGroupSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function SourcesLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading connections
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading connections"
      >
        <h1 className="sr-only">Connections</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton variant="collection" />
          <CollectionGroupSkeleton groups={1} rows={2} subtitle />
          <CollectionGroupSkeleton groups={1} rows={3} subtitle />
          <CollectionGroupSkeleton groups={1} rows={3} subtitle />
          <CollectionGroupSkeleton groups={1} rows={2} subtitle />
        </div>
      </div>
    </>
  );
}
