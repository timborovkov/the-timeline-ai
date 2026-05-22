import { redirect } from 'next/navigation';

// Phase 8: entity profile pages were folded into `/app/objects/[id]`. Keep
// the old URL alive as a redirect so existing links (Telegram replies,
// email citations, agent answers, browser history) resolve to the new page.
// Remove this in Phase 11 once log volume on the redirect is negligible.
export default async function EntityProfileRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/app/objects/${id}`);
}
