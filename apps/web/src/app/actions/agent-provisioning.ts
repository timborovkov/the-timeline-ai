'use server';
import {
  createProvisioningGrant,
  revokeProvisioningGrant,
} from '@timeline/shared/agent-provisioning';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth, getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';

async function ownerId() {
  if ((await getRequestIdentity()).impersonation) throw new Error('Exit impersonation first');
  const session = await auth();
  if (!session?.user.id) throw new Error('Sign in required');
  return session.user.id;
}
export async function createAgentProvisioningAction(
  _previous: { token?: string; error?: string },
  data: FormData,
): Promise<{ token?: string; error?: string }> {
  return runSentryServerAction('create_agent_provisioning', async () => {
    try {
      const grant = await createProvisioningGrant(db, await ownerId(), {
        name: data.get('name'),
        allowance: Number(data.get('allowance')),
        days: Number(data.get('days')),
        allowCapture: data.get('allowCapture') === 'on',
      });
      revalidatePath('/app/agent-provisioning');
      return { token: grant.token };
    } catch {
      return {
        error:
          'Could not create grant. You must be a verified workspace owner. Check the name, allowance, and expiry.',
      };
    }
  });
}
export async function revokeAgentProvisioningAction(data: FormData) {
  return runSentryServerAction('revoke_agent_provisioning', async () => {
    await revokeProvisioningGrant(db, await ownerId(), z.uuid().parse(data.get('id')));
    revalidatePath('/app/agent-provisioning');
  });
}
