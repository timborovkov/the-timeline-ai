import { markNotificationReadAction } from '@/app/actions/objects';
import { appUrl } from '@/lib/site-url';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (request.headers.get('origin') !== appUrl('/').origin) {
    return new Response(null, { status: 403 });
  }

  const { id } = await params;
  const result = await markNotificationReadAction(id);
  return new Response(null, { status: result.error ? 400 : 204 });
}
