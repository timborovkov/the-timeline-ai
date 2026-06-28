import { describe, expect, it } from 'vitest';

import { chatErrorMessage, connectionErrorMessage, searchErrorMessage } from '@/lib/ux-errors';

describe('UX error messages', () => {
  it('maps search configuration failures to human recovery copy', () => {
    expect(searchErrorMessage('search_unconfigured')).toContain('Search is not configured yet');
    expect(searchErrorMessage('search_failed')).toContain('temporarily unavailable');
    expect(searchErrorMessage('rate_limited')).toContain('cooling down');
  });

  it('maps chat API failures without leaking raw JSON codes', () => {
    expect(chatErrorMessage('chat_unconfigured')).toContain('Chat needs OpenRouter and Qdrant');
    expect(chatErrorMessage('session_not_found')).toContain('Start a new chat');
    expect(chatErrorMessage(undefined, 503)).toBe('Chat failed (503).');
  });

  it('maps connection failures to human recovery copy with an action path', () => {
    expect(connectionErrorMessage('forbidden')).toContain('Ask a team admin');
    expect(connectionErrorMessage('oauth_start_failed')).toContain('try again');
    expect(
      connectionErrorMessage('github_rate_limited: retry after 2026-06-25T03:00:00.000Z'),
    ).toContain('Sync will resume automatically');
    expect(
      connectionErrorMessage(
        'github_incremental_partial: 1 repo(s) failed: acme/app (github_repo_sync_partial:acme/app: commits:page_cap (hit 20 pages))',
      ),
    ).toContain('more commit history to catch up');
    expect(
      connectionErrorMessage(
        'github_incremental_partial: 1 repo(s) failed: acme/app (github_repo_sync_partial:acme/app: commits (GitHub GET /repos/acme/app 404: Not Found))',
      ),
    ).toContain('could not read one or more selected repos');
    expect(
      connectionErrorMessage(
        'acme/app:commits:commits (GitHub GET /repos/acme/app/commits?sha=main&per_page=100&page=1 failed with status 404: Not Found)',
      ),
    ).toContain('could not read one or more selected repos');
    expect(
      connectionErrorMessage(
        'acme/super-long-repository-name-for-status-retention-tests:commits:commits (GitHub GET /repos/acme/super-long-repository-name-for-status-retention-tests/commits 404: Not Found)',
      ),
    ).toContain('could not read one or more selected repos');
    expect(
      connectionErrorMessage(
        'acme/app:commits:commits (GitHub GET /repos/acme/app/commits?sha=main&per_page=100&page=1 failed with status 500: Server Error)',
      ),
    ).toContain('temporary error');
    expect(connectionErrorMessage('not_found')).toContain('no longer exists');
    expect(connectionErrorMessage(undefined, 500)).toBe('Connection failed (500).');
  });
});
