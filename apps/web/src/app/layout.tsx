import { getEnv } from '@timeline/shared/env';
import localFont from 'next/font/local';
import Script from 'next/script';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PublicAnalyticsBoundary } from '@/components/public-analytics';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { appleWebApp, pwaViewport } from '@/lib/pwa-splash';
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
    default: 'AI Team Memory With Cited Answers · The Timeline',
    template: '%s · The Timeline',
  },
  description:
    'Timeline turns selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
  keywords: [
    'AI team memory',
    'project memory',
    'project history',
    'team memory',
    'cross-tool knowledge base',
    'meeting transcript search',
    'Slack knowledge base',
    'cited AI answers',
    'project status AI',
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
  appleWebApp,
  openGraph: {
    title: 'AI Team Memory With Cited Answers · The Timeline',
    description:
      'Turn selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
    url: '/',
    siteName: 'The Timeline',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'The Timeline — AI team memory with cited answers',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Team Memory With Cited Answers · The Timeline',
    description:
      'Turn selected team work into a searchable project history with cited answers you can verify.',
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

export const viewport: Viewport = pwaViewport;

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
        <ThemeProvider>
          <PublicAnalyticsBoundary>{children}</PublicAnalyticsBoundary>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
