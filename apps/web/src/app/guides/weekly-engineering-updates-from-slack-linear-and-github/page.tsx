import type { Metadata } from 'next';

import { findEditorialGuideByRoute, GUIDE_ROUTES } from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { EditorialGuidePage } from '@/components/marketing/editorial/guide-page';
import {
  buildGuideStructuredData,
  createGuideMetadata,
} from '@/components/marketing/editorial/metadata';

const guide = findEditorialGuideByRoute(GUIDE_ROUTES.weeklyEngineeringUpdates);

export const metadata: Metadata = createGuideMetadata(guide);

export default function WeeklyEngineeringUpdatesGuidePage() {
  return (
    <>
      <EditorialStructuredData data={buildGuideStructuredData(guide)} />
      <EditorialGuidePage guide={guide} />
    </>
  );
}
