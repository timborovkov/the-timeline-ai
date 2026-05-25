import { redirect } from 'next/navigation';

// Phase 8: entities became the data model for workspace objects, surfaced
// under /app/objects. Keep this redirect for one release so deep links from
// emails and old sessions still resolve.
export default function EntitiesIndexRedirect() {
  redirect('/app/objects');
}
