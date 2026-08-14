import { permanentRedirect } from 'next/navigation';

import { HOW_IT_WORKS_ROUTE } from '@/components/marketing/editorial/content';

export default function LegacyRecordPage() {
  permanentRedirect(HOW_IT_WORKS_ROUTE);
}
