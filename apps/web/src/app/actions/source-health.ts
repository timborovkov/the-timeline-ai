'use server';

import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export async function repairSourceIndex(form: FormData) {
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
  const jobs = await scope.sourceHealth.indexJobs(parsed.data.kind, parsed.data.key);
  const queue = await requireRedisQueue();
  for (const job of jobs) await queue.enqueueEmbedJob(job);
  revalidatePath('/app/connections/health');
}
