import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { isPersonalAccountPath } from '@/lib/platform-request-gate';

describe('isPersonalAccountPath', () => {
  it('treats agent provisioning as an account-bound impersonation block', () => {
    expect(isPersonalAccountPath('/app/agent-provisioning')).toBe(true);
    expect(isPersonalAccountPath('/app/billing')).toBe(true);
    expect(isPersonalAccountPath('/app/connect-agent')).toBe(true);
    expect(isPersonalAccountPath('/app/timeline')).toBe(false);
  });
});
