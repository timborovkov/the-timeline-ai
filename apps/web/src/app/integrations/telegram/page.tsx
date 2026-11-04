import { TELEGRAM_PUBLIC_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
import { TelegramIntegrationPage } from '@/components/marketing/integrations/telegram-page';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(TELEGRAM_PUBLIC_DOCUMENT);

export default function TelegramIntegrationRoutePage() {
  return <TelegramIntegrationPage />;
}
