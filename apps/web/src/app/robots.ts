import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/site-url';

const PRIVATE_PATHS = ['/app/', '/api/', '/sign-in', '/sign-up', '/accept-invite/'];

const AI_AND_SEARCH_BOTS = [
  'Googlebot',
  'Bingbot',
  'DuckDuckBot',
  'PerplexityBot',
  'Perplexity-User',
  'ChatGPT-User',
  'OAI-SearchBot',
  'GPTBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'YandexBot',
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      ...AI_AND_SEARCH_BOTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
