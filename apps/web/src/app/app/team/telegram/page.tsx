import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Telegram',
  description: 'Configure Telegram capture and bindings.',
};

export default function TelegramSettingsPage() {
  redirect('/app/sources#telegram');
}
