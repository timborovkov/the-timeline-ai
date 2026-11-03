import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import TelegramIntegrationRoutePage from '@/app/integrations/telegram/page';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';

describe('Telegram integration route', () => {
  it('renders the drafted Telegram capture page without claiming a silent account sync', () => {
    const html = renderToStaticMarkup(<TelegramIntegrationRoutePage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(TELEGRAM_PAGE.title);
    expect(html).toContain('data-telegram-integration');
    expect(html).toContain('Start free');
    expect(html).toContain(TELEGRAM_PAGE.captured);
    expect(html).toContain(TELEGRAM_PAGE.boundary);
    expect(html).toContain(TELEGRAM_PAGE.dailyUpdate);
    expect(html).not.toMatch(/WhatsApp|Slack Connect|passive account-history sync is/iu);
    expect(html).toContain('Telegram is not a passive account-history sync');
  });
});
