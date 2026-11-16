import { startWebsiteScan } from '@timeline/shared/websites';
import { z } from 'zod';

import { websiteBody, websiteResponse, websiteScope } from '@/app/api/websites/_shared';
interface Context {
  params: Promise<{ id: string }>;
}
export async function POST(req: Request, context: Context) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'websites:scan');
    const { id } = await context.params;
    const input = z
      .strictObject({ permissionConfirmed: z.literal(true) })
      .parse(await websiteBody(req));
    const idempotencyKey = z.string().min(1).max(200).parse(req.headers.get('idempotency-key'));
    const run = await startWebsiteScan(scope, { websiteId: id, idempotencyKey, ...input });
    const statusUrl = `/api/websites/${id}/scans/${run.id}`;
    return Response.json(
      { run, statusUrl },
      { status: run.status === 'blocked' ? 409 : 202, headers: { location: statusUrl } },
    );
  });
}
