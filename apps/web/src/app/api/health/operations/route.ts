import { getEnv } from '@timeline/shared/env';

import {
  authorizeOperatorProbe,
  operatorProbeHeaders,
  probeUnavailable,
} from '@/lib/operator-probe';
import { processingHealth } from '@/lib/processing-health';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = authorizeOperatorProbe(request, getEnv().CRON_SECRET);
  if (denied) return denied;
  try {
    const health = await processingHealth();
    return Response.json(health, { status: health.ok ? 200 : 503, headers: operatorProbeHeaders });
  } catch {
    return probeUnavailable();
  }
}
