// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatHandoffKey } from '@/lib/chat-handoff';

const fakes = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fakes.push }) }));

const { HomeAskComposer } = await import('@/components/home/home-ask-composer');

describe('HomeAskComposer', () => {
  beforeEach(() => {
    fakes.push.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('validates an empty question without navigating', () => {
    render(<HomeAskComposer teamId="team-1" />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Ask/ }).disabled).toBe(true);
    expect(fakes.push).not.toHaveBeenCalled();
  });

  it('stores a team-scoped prompt and navigates without prompt text in the URL', () => {
    render(<HomeAskComposer teamId="team-1" />);
    fireEvent.change(screen.getByLabelText('Question for Ask'), {
      target: { value: '  What is blocked?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ask/ }));

    expect(fakes.push).toHaveBeenCalledWith('/app/chat');
    expect(window.sessionStorage.getItem(chatHandoffKey('team-1'))).toContain('What is blocked?');
    expect(fakes.push.mock.calls[0]?.[0]).not.toContain('What%20is%20blocked');
  });

  it('stays on Home when session storage is unavailable', () => {
    const originalStorage = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: originalStorage.getItem.bind(originalStorage),
        removeItem: originalStorage.removeItem.bind(originalStorage),
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    render(<HomeAskComposer teamId="team-1" />);
    fireEvent.change(screen.getByLabelText('Question for Ask'), {
      target: { value: 'What changed?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ask/ }));

    expect(screen.getByRole('alert').textContent).toContain('temporary browser storage');
    expect(fakes.push).not.toHaveBeenCalled();
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: originalStorage });
  });
});
