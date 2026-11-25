import { expect } from '@timeline/test-support';
import { it } from 'bun:test';
import { DrizzleQueryError } from 'drizzle-orm/errors';

import { withGuestErrorRedaction } from '@/lib/guest-access-errors';

it('keeps guest query parameters and the raw database cause out of reported errors', async () => {
  const secret = 'Synthetic snapshot marker';
  const cause = new Error(secret);
  const failure = new DrizzleQueryError('INSERT VALUES ($1)', [secret], cause);
  const safe = withGuestErrorRedaction(() => Promise.reject(failure));
  await expect(safe).rejects.toMatchObject({ message: 'Conversation operation failed' });
  try {
    await safe;
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty('cause');
  }
});

it('preserves framework control-flow exceptions', async () => {
  const redirect = new Error('NEXT_REDIRECT');
  await expect(withGuestErrorRedaction(() => Promise.reject(redirect))).rejects.toBe(redirect);
});
