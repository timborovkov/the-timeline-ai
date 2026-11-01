import {
  CollectionRowSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';

export default function CapturedDocumentsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading captured files
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading captured files"
      >
        <h1 className="sr-only">Captured files</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton variant="collection" action />
          <CollectionToolbarSkeleton search={false} />
          <ul aria-label="Captured files loading placeholder">
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index}>
                <CollectionRowSkeleton leading subtitle metadata={2} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
