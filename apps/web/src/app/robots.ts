import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

const DISALLOWED_PATHS = [
  '/api/',
  '/app$',
  '/app/',
  '/guest/',
  '/accept-invite/',
  '/verify-email/',
];

const SEARCH_BOTS = [
  'Googlebot',
  'Bingbot',
  'DuckDuckBot',
  'Applebot',
  'YandexBot',
  'PerplexityBot',
  'OAI-SearchBot',
  'Claude-SearchBot',
];

const USER_RETRIEVAL_BOTS = ['Perplexity-User', 'ChatGPT-User', 'Claude-User'];

const TRAINING_AND_BULK_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOWED_PATHS },
      { userAgent: SEARCH_BOTS, allow: '/', disallow: DISALLOWED_PATHS },
      { userAgent: USER_RETRIEVAL_BOTS, allow: '/', disallow: DISALLOWED_PATHS },
      { userAgent: TRAINING_AND_BULK_BOTS, disallow: '/' },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
