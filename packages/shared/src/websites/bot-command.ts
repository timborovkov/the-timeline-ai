import { getEnv } from '#src/env.js';
import { withTeam } from '#src/team-scope.js';
import { normalizeWebsiteUrl } from '#src/websites/policy.js';
import { startWebsiteScan } from '#src/websites/runtime.js';

import type { DeferredChatDelivery } from '#src/conversation-surfaces/deferred-delivery.js';
import type { Db } from '@timeline/db';

export async function websiteBotCommand(input: {
  db: Db;
  teamId: string;
  userId: string;
  arg: string;
  command: string;
  requestId: string;
  delivery: Omit<DeferredChatDelivery, 'body'> & { body: Record<string, unknown> };
}): Promise<string> {
  const [rawUrl, confirmation] = input.arg.trim().split(/\s+/);
  if (!rawUrl) return `Usage: ${input.command} <public-url>`;
  const url = normalizeWebsiteUrl(rawUrl);
  const scope = withTeam(input.db, input.teamId, input.userId);
  await scope.requireMembership();
  const team = await scope.timeline.team();
  if (confirmation !== 'confirm')
    return `Team: ${team?.name ?? input.teamId}. Scan up to five public pages for up to 100 source units (20 per page), plus AI and storage. By confirming, you confirm permission to submit this website. Reply: ${input.command} ${url} confirm`;
  const existing = (await scope.websites.list()).find((source) => source.url === url);
  const source =
    existing ??
    (await scope.websites.add({ url, subject: 'other_company', permissionConfirmed: true }));
  const sourceUrl = new URL('/app/connections/websites', getEnv().AUTH_URL);
  sourceUrl.searchParams.set('source', source.id);
  const link = sourceUrl.href;
  const run = await startWebsiteScan(scope, {
    websiteId: source.id,
    idempotencyKey: input.requestId,
    permissionConfirmed: true,
    trigger: 'bot',
    notification: {
      ...input.delivery,
      body: {
        ...input.delivery.body,
        text: `Your website scan has finished or needs attention. View its status, usage, and captured pages: ${link}`,
      },
    },
  });
  return run.status === 'blocked'
    ? `Website scan is blocked by billing limits. ${link}`
    : `Website scan queued. Up to 100 source units. Status: ${link}`;
}
