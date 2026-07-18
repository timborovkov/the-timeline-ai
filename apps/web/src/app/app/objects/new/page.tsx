import type { Metadata } from 'next';

import { HistoryBackLink } from '@/components/history-back-link';
import { NewObjectForm } from '@/components/objects/new-object-form';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export const metadata: Metadata = {
  title: 'New object',
  description: 'Create a tracked timeline object.',
};

const objectsBackLink = <HistoryBackLink fallbackHref="/app/objects" label="Back" />;

export default function NewObjectPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New object"
        subtitle="Create a tracked object for your team."
        leading={objectsBackLink}
      />
      <WorkSubnav current="/app/objects/new" />
      <NewObjectForm />
    </div>
  );
}
