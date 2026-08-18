// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: vi.fn(() => '/app/objects/44444444-4444-4444-8444-444444444444'),
  searchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/navigation', () => ({
  usePathname: fakes.pathname,
  useSearchParams: fakes.searchParams,
}));

const { ChatViewContextBinder, ChatViewProvider, useCurrentChatView } =
  await import('./chat-view-context.js');

function LabelProbe({ onRender }: { onRender: () => void }) {
  onRender();
  const { current } = useCurrentChatView();
  return <p>{current.label}</p>;
}

afterEach(() => {
  cleanup();
});

describe('ChatViewContextBinder', () => {
  it('registers overlay labels without looping', () => {
    let renders = 0;
    render(
      <ChatViewProvider>
        <ChatViewContextBinder
          viewKey="object:1"
          kind="object"
          href="/app/objects/44444444-4444-4444-8444-444444444444"
          label="Project Atlas"
          objectId="44444444-4444-4444-8444-444444444444"
        />
        <LabelProbe
          onRender={() => {
            renders += 1;
          }}
        />
      </ChatViewProvider>,
    );
    expect(screen.getByText('Project Atlas')).toBeTruthy();
    expect(renders).toBeLessThan(8);
  });

  it('names selected list items instead of the route label', () => {
    fakes.pathname.mockReturnValue('/app/tasks');
    fakes.searchParams.mockReturnValue(
      new URLSearchParams('task=77777777-7777-4777-8777-777777777777'),
    );
    render(
      <ChatViewProvider>
        <ChatViewContextBinder
          viewKey="task:1"
          kind="task"
          href="/app/tasks?task=77777777-7777-4777-8777-777777777777"
          label="Approve vendor security appendix"
          taskId="77777777-7777-4777-8777-777777777777"
        />
        <LabelProbe onRender={() => undefined} />
      </ChatViewProvider>,
    );
    expect(screen.getByText('Approve vendor security appendix')).toBeTruthy();
  });
});
