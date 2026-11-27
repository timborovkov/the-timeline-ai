'use server';

import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { runSentryServerAction } from '@/lib/sentry-action';

export async function repairSourceIndex(form: FormData) {
  return runSentryServerAction('repair_source_index', async () => {
    const parsed = z
      .object({
        kind: z.enum(['source', 'object', 'calendar', 'document']),
        key: z.string().max(100),
      })
      .safeParse({ kind: form.get('kind'), key: form.get('key') });
    const session = await auth();
    if (!parsed.success || !session?.user) return;
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return;
    const scope = withTeam(db, active.teamId, session.user.id);
    const [jobs, queue] = await Promise.all([
      scope.sourceHealth.indexJobs(parsed.data.kind, parsed.data.key),
      requireRedisQueue(),
    ]);
    await Promise.all(jobs.map((job) => queue.enqueueEmbedJob(job)));
    revalidatePath('/app/connections/health');
  });
}
