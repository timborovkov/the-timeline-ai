import { provisionWorkspace, ProvisioningError } from '@timeline/shared/agent-provisioning';
import { childLogger } from '@timeline/shared/logger';
import { ZodError } from 'zod';

import { db } from '@/lib/db';
import { readCappedTextBody } from '@/lib/request-body';
import { appUrl } from '@/lib/site-url';

const log = childLogger('web:agent-provisioning');
export async function POST(request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const token = request.headers
      .get('authorization')
      ?.match(/^Bearer (tlp_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new ProvisioningError('invalid_credential', 401);
    const body = await readCappedTextBody(request, 4096);
    if (body.tooLarge) throw new ProvisioningError('body_too_large', 413);
    const result = await provisionWorkspace(
      db,
      token,
      request.headers.get('idempotency-key') ?? '',
      JSON.parse(body.text),
    );
    return Response.json(
      { ...(result as Record<string, unknown>), mcpEndpoint: appUrl('/api/mcp/server').toString() },
      { status: 201, headers },
    );
  } catch (error) {
    const status =
      error instanceof ProvisioningError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    const code =
      error instanceof ProvisioningError
        ? error.code
        : status === 400
          ? 'invalid_request'
          : 'provisioning_failed';
    log.warn({ code, status }, 'agent_provisioning_failed');
    return Response.json({ error: code }, { status, headers });
  }
}
