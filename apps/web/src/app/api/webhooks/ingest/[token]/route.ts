import { handleGet, handlePost } from '@/app/api/webhooks/ingest/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  return handleGet(req, token);
}

// react-doctor-disable-next-line react-doctor/webhook-signature-risk -- Delegates to the generic ingest handler, which authenticates with the path token as a Timeline-issued credential.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  return handlePost(req, token);
}
