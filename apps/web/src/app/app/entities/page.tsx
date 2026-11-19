import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Entities',
  description: 'Browse entities discovered across the timeline.',
};

// Phase 8: entities became the data model for workspace objects, surfaced
// under /app/objects. Keep this redirect for one release so deep links from
// emails and old sessions still resolve.
export default function EntitiesIndexRedirect() {
  redirect('/app/objects');
}
