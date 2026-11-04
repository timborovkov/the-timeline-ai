import { CompareHubPage } from '@/components/marketing/compare/compare-hub';
import { findCompareHubDocument } from '@/components/marketing/compare/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(findCompareHubDocument());

export default function CompareRoutePage() {
  return <CompareHubPage />;
}
