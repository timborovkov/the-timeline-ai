import * as rateLimit from '@timeline/shared/rate-limit';

import { clientIpFromHeaders } from '@/lib/request-ip';
import { reportHandledEvent } from '@/lib/sentry-report';

export async function checkCredentialsSignInRateLimit(
  email: string,
  headers: Headers,
): Promise<boolean> {
  const clientIp = clientIpFromHeaders(headers);
  if (clientIp) {
    const ipLimit = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('signin', 'ip', clientIp),
      ...rateLimit.RATE_LIMITS.signIn,
    });
    if (!ipLimit.ok) {
      reportCredentialsSignInRateLimited('ip');
      return false;
    }
  }

  const emailLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('signin', 'email', email),
    ...rateLimit.RATE_LIMITS.signIn,
  });
  if (!emailLimit.ok) {
    reportCredentialsSignInRateLimited('email');
    return false;
  }

  return true;
}

function reportCredentialsSignInRateLimited(bucket: 'ip' | 'email'): void {
  reportHandledEvent({
    message: 'auth_credentials_signin_rate_limited',
    surface: 'api',
    operation: 'credentials_authorize',
    tags: { reason: 'rate_limited', bucket },
  });
}
