// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SkipLink } from '@/components/skip-link';

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
