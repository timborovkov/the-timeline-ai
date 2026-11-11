import {
  websiteBody,
  websiteInput,
  websiteResponse,
  websiteScope,
} from '@/app/api/websites/_shared';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return websiteResponse(async () =>
    Response.json(
      { websites: await (await websiteScope(req, 'read')).websites.list() },
      { headers: { 'cache-control': 'no-store' } },
    ),
  );
}
export async function POST(req: Request) {
  return websiteResponse(async () => {
    const scope = await websiteScope(req, 'websites:scan');
    const website = await scope.websites.add(websiteInput.parse(await websiteBody(req)));
    return Response.json({ website }, { status: 201 });
  });
}
