import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

// The LLM files emit Markdown destinations, standalone URL lines and inline examples.
const HTTP_URL = /https?:\/\/[^\s<>()\[\]"'`\\]+/gu;

export function llmsUrlReferences(markdown: string): Set<string> {
  return new Set(Array.from(markdown.matchAll(HTTP_URL), ([url]) => url.replace(/[.,;!?]+$/u, '')));
}

export function withLlmsOrigin(markdown: string, siteUrl: string): string {
  const origin = new URL(siteUrl).origin;
  if (origin === CANONICAL_PUBLIC_ORIGIN) return markdown;
  return markdown.replace(HTTP_URL, (reference) => {
    const url = URL.parse(reference.replace(/[.,;!?]+$/u, ''));
    return url?.origin === CANONICAL_PUBLIC_ORIGIN
      ? origin + reference.slice(CANONICAL_PUBLIC_ORIGIN.length)
      : reference;
  });
}
