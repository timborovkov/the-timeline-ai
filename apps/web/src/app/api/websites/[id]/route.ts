import { z } from 'zod';

import {
  scheduleInput,
  websiteBody,
  websiteResponse,
  websiteScope,
} from '@/app/api/websites/_shared';
const patch = z.strictObject({
  schedule: scheduleInput.optional(),
  paused: z.boolean().optional(),
});
interface Context {
  params: Promise<{ id: string }>;
}
export async function GET(req: Request, context: Context) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'read');
    const { id } = await context.params;
    return Response.json(
      { website: await scope.websites.get(id), runs: await scope.websites.history(id) },
      { headers: { 'cache-control': 'no-store' } },
    );
  });
}
export async function PATCH(req: Request, context: Context) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'websites:manage');
    const { id } = await context.params;
    return Response.json({
      website: await scope.websites.configure(id, patch.parse(await websiteBody(req))),
    });
  });
}
export async function DELETE(req: Request, context: Context) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'websites:manage');
    const { id } = await context.params;
    await scope.websites.configure(id, { archive: true });
    return Response.json({ ok: true });
  });
}
