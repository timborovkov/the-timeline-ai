import {
  CollectionGroupSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';

export default function ObjectsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading objects
      </output>
      <div
        data-app-width="collection"
        data-app-layout="full-bleed"
        className="flex h-full min-w-0 flex-col motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading objects"
      >
        <h1 className="sr-only">Objects</h1>
        <div aria-hidden="true" inert className="px-4 md:px-8">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <div aria-hidden="true" inert className="space-y-0">
          <CollectionToolbarSkeleton action secondaryAction />
          <CollectionGroupSkeleton groups={2} rows={4} leading={false} />
        </div>
      </div>
    </>
  );
}
