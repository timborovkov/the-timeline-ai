import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { useHydrated } from '@/lib/use-hydrated';
// Test environment: happy-dom

function HydrationProbe() {
  return <span>{useHydrated() ? 'client' : 'server'}</span>;
}

describe('useHydrated', () => {
  it('stays on the server snapshot during SSR and flips after client render', () => {
    expect(renderToStaticMarkup(<HydrationProbe />)).toBe('<span>server</span>');

    render(<HydrationProbe />);
    expect(screen.getByText('client')).toBeTruthy();
  });
});
