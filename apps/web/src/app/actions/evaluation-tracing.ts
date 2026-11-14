'use server';

import { revalidatePath } from 'next/cache';

import { resolveScope } from '@/lib/action-scope';
import { runSentryServerAction } from '@/lib/sentry-action';

export interface EvaluationActionState {
  error?: string;
  saved?: boolean;
}
export async function configureEvaluationTracingAction(
  _previous: EvaluationActionState,
  data: FormData,
): Promise<EvaluationActionState> {
  return runSentryServerAction('evaluation_tracing_configure', async () => {
    try {
      const r = await resolveScope();
      if (!r.ok || data.get('teamId') !== r.teamId)
        return { error: 'Workspace changed. Reopen this page.' };
      await r.scope.evaluationTracing.configure({
        enabled: data.get('enabled') === 'on',
        sources: data.getAll('sources'),
        consent: data.get('consent') === 'on',
        consentVersion: data.get('consentVersion'),
      });
      revalidatePath('/app/team/evaluation');
      return { saved: true };
    } catch {
      return {
        error:
          'Could not save. A current owner or admin must select sources and acknowledge the disclosure to opt in.',
      };
    }
  });
}
