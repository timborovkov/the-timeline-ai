'use server';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';

export async function updateAgentReportingAction(
  _previous: { error?: string; saved?: boolean },
  data: FormData,
): Promise<{ saved?: boolean; error?: string }> {
  return runSentryServerAction('update_mcp_reporting', async () => {
    try {
      const session = await auth();
      if (!session?.user.id) throw new Error('Sign in required');
      const teamId = z.uuid().parse(data.get('teamId'));
      const type = z.enum(['workspace', 'oauth', 'api_key']).parse(data.get('type'));
      const id = data.get('id') ? z.uuid().parse(data.get('id')) : undefined;
      const mode = data.get('mode');
      await withTeam(db, teamId, session.user.id).agentReporting.update(
        { type, ...(id ? { id } : {}) },
        mode === 'inherit' ? null : { mode, scope: data.get('scope') ?? '' },
      );
      revalidatePath('/app/connect-agent');
      return { saved: true };
    } catch {
      return {
        error:
          'Could not save. Ongoing reporting needs a work scope, and only workspace owners or admins can edit these settings.',
      };
    }
  });
}
