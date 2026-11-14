'use server';
import { readDiagnosticReport } from '@timeline/shared/diagnostics/operator';
import { revalidatePath } from 'next/cache';

import { resolveScope, uuidSchema } from '@/lib/action-scope';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
import { runSentryServerAction } from '@/lib/sentry-action';

export interface DiagnosticActionState {
  error?: string;
  saved?: boolean;
}
// Fail closed without sending submitted content or database exceptions to telemetry.
export async function submitDiagnosticAction(
  _previous: DiagnosticActionState,
  data: FormData,
): Promise<DiagnosticActionState> {
  return runSentryServerAction('diagnostics_submit', async () => {
    try {
      const r = await resolveScope();
      if (!r.ok || data.get('teamId') !== r.teamId)
        return { error: 'Workspace changed. Reopen this page.' };
      await r.scope.diagnostics.submit({
        sessionId: data.get('sessionId'),
        description: data.get('description'),
        conversation: data.get('conversation'),
        consent: data.get('consent') === 'on',
        consentVersion: data.get('consentVersion'),
      });
      revalidatePath('/app/diagnostics');
      return { saved: true };
    } catch {
      return {
        error:
          'Could not send. Check the fields and workspace sharing permission. You can send up to ten reports per day.',
      };
    }
  });
}
export async function configureDiagnosticAction(
  _previous: DiagnosticActionState,
  data: FormData,
): Promise<DiagnosticActionState> {
  return runSentryServerAction('diagnostics_configure', async () => {
    try {
      const r = await resolveScope();
      if (!r.ok || data.get('teamId') !== r.teamId)
        return { error: 'Workspace changed. Reopen this page.' };
      await r.scope.diagnostics.configure(data.get('enabled') === 'on');
      revalidatePath('/app/diagnostics');
      return { saved: true };
    } catch {
      return { error: 'Only current workspace owners and admins can change sharing.' };
    }
  });
}
export async function deleteDiagnosticAction(
  _previous: DiagnosticActionState,
  data: FormData,
): Promise<DiagnosticActionState> {
  return runSentryServerAction('diagnostics_delete', async () => {
    try {
      const r = await resolveScope();
      if (!r.ok || data.get('teamId') !== r.teamId)
        return { error: 'Workspace changed. Reopen this page.' };
      await r.scope.diagnostics.remove(uuidSchema.parse(data.get('reportId')));
      revalidatePath('/app/diagnostics');
      return { saved: true };
    } catch {
      return { error: 'Could not delete this report. Try again.' };
    }
  });
}
export async function readDiagnosticAction(id: string) {
  const actor = await requireAdmin();
  try {
    return { report: await readDiagnosticReport(db, actor, id) };
  } catch {
    return { error: 'Report unavailable or expired.' };
  }
}
