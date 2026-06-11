import type { Metadata } from 'next';

import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { NewObjectForm } from '@/components/objects/new-object-form';

export const metadata: Metadata = {
  title: 'New object',
  description: 'Create a tracked timeline object.',
};

export default function NewObjectPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <IndexStrip
        srLabel="Create a new workspace object"
        segments={[{ value: 'OBJECTS / NEW' }, { label: 'mode', value: 'create', signal: true }]}
      >
        <HistoryBackLink fallbackHref="/app/objects" label="Back" />
      </IndexStrip>
      <NewObjectForm />
    </div>
  );
}
