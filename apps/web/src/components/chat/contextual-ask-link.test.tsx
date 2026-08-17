// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatHandoffKey } from '@/lib/chat-handoff';

const fakes = vi.hoisted(() => ({ push: vi.fn(), notifyError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fakes.push }) }));
vi.mock('@/lib/notify', () => ({
  notifyAction: vi.fn(async ({ run }: { run: () => Promise<{ error?: string }> }) => run()),
  notifyError: (...args: unknown[]) => fakes.notifyError(...args),
}));

const { ContextualAskLink } = await import('@/components/chat/contextual-ask-link');

describe('ContextualAskLink', () => {
  beforeEach(() => {
    fakes.push.mockReset();
    fakes.notifyError.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it('stores context and navigates without exposing internal IDs in the URL', () => {
    render(
      <ContextualAskLink
        teamId="team-1"
        context={{
          pathname: '/app/objects/object-1',
          routeKind: 'object-detail',
          objectId: 'object-1',
        }}
        pinnedEntityId="object-1"
        pinnedEntityName="Launch plan"
        label="Ask about object"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask about object' }));

    expect(fakes.push).toHaveBeenCalledWith('/app/chat');
    expect(fakes.push.mock.calls[0]?.[0]).not.toContain('object-1');
    expect(window.sessionStorage.getItem(chatHandoffKey('team-1'))).toContain('Launch plan');
  });
});
