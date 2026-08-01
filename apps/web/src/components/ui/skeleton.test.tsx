// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '@/components/ui/skeleton';

describe('Skeleton', () => {
  it('disables its pulse animation when reduced motion is preferred', () => {
    const { container } = render(<Skeleton />);

    expect(container.firstElementChild?.className).toContain('animate-pulse');
    expect(container.firstElementChild?.className).toContain('motion-reduce:animate-none');
  });
});
