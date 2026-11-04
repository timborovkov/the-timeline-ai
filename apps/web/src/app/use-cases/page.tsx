import { USE_CASE_HUB } from '@/components/marketing/use-cases/content';
import { USE_CASE_PUBLIC_DOCUMENTS } from '@/components/marketing/use-cases/public-documents';
import { UseCaseHubPage } from '@/components/marketing/use-cases/use-case-hub';
import { metadataForPublicDocument } from '@/lib/public-site';

const hubDocument = USE_CASE_PUBLIC_DOCUMENTS.documents.find(
  (document) => document.canonicalPath === USE_CASE_HUB.route,
);
if (!hubDocument) throw new Error('The public document registry is missing the use-cases hub');

export const metadata = metadataForPublicDocument(hubDocument);

export default function UseCasesRoutePage() {
  return <UseCaseHubPage />;
}
