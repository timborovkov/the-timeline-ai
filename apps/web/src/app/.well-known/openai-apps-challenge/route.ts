export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** OpenAI plugin-domain verification. The portal requires the exact token only. */
export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) return new Response(null, { status: 404 });
  return new Response(token, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
