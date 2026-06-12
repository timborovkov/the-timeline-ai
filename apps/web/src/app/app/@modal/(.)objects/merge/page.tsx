import type { Metadata } from 'next';

import { MergeObjectsRouteContent } from '@/app/app/objects/merge/merge-route-content';

export const metadata: Metadata = {
  title: 'Merge Objects',
  description: 'Review and merge selected workspace objects.',
};

export default async function MergeObjectsModalPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; suggestionItemId?: string }>;
}) {
  return MergeObjectsRouteContent({ presentation: 'modal', searchParams });
}
