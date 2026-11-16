import { websiteResponse, websiteScope } from '@/app/api/websites/_shared';
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'read');
    const { id, runId } = await context.params;
    const run = await scope.websites.getRun(runId);
    if (run.websiteId !== id) throw new Error('Website scan not found');
    return Response.json({ run }, { headers: { 'cache-control': 'no-store' } });
  });
}
