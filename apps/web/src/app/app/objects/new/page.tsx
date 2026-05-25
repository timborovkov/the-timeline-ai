import Link from 'next/link';

import { IndexStrip } from '@/components/index-strip';
import { NewObjectForm } from '@/components/objects/new-object-form';

export default function NewObjectPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <IndexStrip
        srLabel="Create a new workspace object"
        segments={[{ value: 'OBJECTS / NEW' }, { label: 'mode', value: 'create', signal: true }]}
        trailing={
          <Link
            href="/app/objects"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg hover:underline"
          >
            ← all objects
          </Link>
        }
      />
      <NewObjectForm />
    </div>
  );
}
