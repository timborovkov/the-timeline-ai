import { getEnv } from '@timeline/shared/env';
import localFont from 'next/font/local';
import Script from 'next/script';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SIDEBAR_PREFERENCE_BOOTSTRAP } from '@/lib/sidebar-preference';
import { getSiteUrl } from '@/lib/site-url';

import './globals.css';

const switzer = localFont({
  variable: '--font-switzer',
  display: 'swap',
  src: [
    {
      path: '../../public/fonts/switzer/Switzer-Variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../public/fonts/switzer/Switzer-VariableItalic.woff2',
      weight: '100 900',
      style: 'italic',
    },
  ],
});

const commitMono = localFont({
  variable: '--font-commit-mono',
  display: 'swap',
  src: [
    {
      path: '../../public/fonts/commit-mono/CommitMono-400-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/commit-mono/CommitMono-400-Italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../public/fonts/commit-mono/CommitMono-700-Regular.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'The Timeline — The operations log your team can talk to',
    template: '%s · The Timeline',
  },
  description:
    'Voice-, chat-, email-, meeting-, document-, and integration-first capture, agentically compiled into a searchable team history with auditable citations on every answer.',
  keywords: [
    'AI CRM',
    'team memory',
    'operations log',
    'AI knowledge base',
    'meeting transcript search',
    'Slack knowledge base',
    'Telegram bot CRM',
    'cited AI answers',
  ],
  applicationName: 'The Timeline',
  authors: [{ name: 'The Timeline' }],
  creator: 'The Timeline',
  publisher: 'The Timeline',
  category: 'Business software',
  formatDetection: { telephone: false, email: false, address: false },
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'The Timeline',
    // Non-overlaying: black-translucent draws under the status bar without safe-area padding.
    statusBarStyle: 'black',
  },
  openGraph: {
    title: 'The Timeline — The operations log your team can talk to',
    description:
      'Capture voice notes, Slack threads, emails, meetings, documents, calendar events, and native integration activity into one searchable team history with cited AI answers.',
    url: '/',
    siteName: 'The Timeline',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'The Timeline — the operations log your team can talk to',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Timeline — The operations log your team can talk to',
    description:
      'Capture work as it happens; the agent files it into a cited, searchable team history.',
    images: ['/twitter-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const taskCategoriesEnabled = getEnv().TASK_CATEGORY_UI_ENABLED;
  return (
    <html
      lang="en"
      className={`${switzer.variable} ${commitMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        data-task-categories-enabled={taskCategoriesEnabled ? 'true' : 'false'}
      >
        <Script id="sidebar-preference" strategy="beforeInteractive">
          {SIDEBAR_PREFERENCE_BOOTSTRAP}
        </Script>
        <Script
          src="https://aromatic-caribou-889.convex.site/api/a/am_7eCe5quSdP7W1Kx7"
          strategy="afterInteractive"
        />
        <ThemeProvider>
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
