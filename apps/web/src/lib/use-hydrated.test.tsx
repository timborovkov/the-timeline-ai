// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useHydrated } from '@/lib/use-hydrated';

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
