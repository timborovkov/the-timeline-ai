import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { SkipLink } from '@/components/skip-link';
// Test environment: happy-dom

describe('SkipLink', () => {
  it('retains its fixed overlay positioning and padding when focused', () => {
    render(<SkipLink />);

    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.className).toContain('focus:not-sr-only');
    expect(link.className).toContain('focus:fixed');
    expect(link.className).toContain('focus:left-3');
    expect(link.className).toContain('focus:top-3');
    expect(link.className).toContain('focus:p-3');
  });
});
