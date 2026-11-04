import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

export function GET() {
  return new Response(
    [
      `Contact: ${CANONICAL_PUBLIC_ORIGIN}/help/support`,
      'Expires: 2027-11-01T00:00:00Z',
      'Preferred-Languages: en',
      `Canonical: ${CANONICAL_PUBLIC_ORIGIN}/.well-known/security.txt`,
      `Policy: ${CANONICAL_PUBLIC_ORIGIN}/trust`,
      '',
    ].join('\n'),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    },
  );
}
