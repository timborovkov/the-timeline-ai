import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { connectionsTabHref } from '@/lib/connections';

export const metadata: Metadata = {
  title: 'Telegram',
  description: 'Configure Telegram capture and bindings.',
};

export default function TelegramSettingsPage() {
  redirect(connectionsTabHref('sources', 'telegram'));
}
