import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';

export default function IntegrationsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Opening connections
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Opening connections"
      >
        <h1 className="sr-only">Team integrations</h1>
        <Breadcrumb
          items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Integrations' }]}
        />
        <PageHeaderSkeleton />
      </div>
    </>
  );
}
