import { ProductTourPage } from '@/components/marketing/product-tour/product-tour-page';
import { PRODUCT_TOUR_DOCUMENT } from '@/components/marketing/use-cases/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(PRODUCT_TOUR_DOCUMENT);

export default function ProductTourRoutePage() {
  return <ProductTourPage />;
}
