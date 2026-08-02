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

  it('keeps decorative loading blocks out of the accessibility tree without dropping loading metadata', () => {
    const { container } = render(<Skeleton className="h-4 w-24" data-loading-filter />);
    const skeleton = container.firstElementChild;

    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.hasAttribute('data-loading-filter')).toBe(true);
    expect(
      skeleton?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });

  it('rejects focusable props', () => {
    // @ts-expect-error Decorative skeletons must never be keyboard-focusable.
    const skeleton = <Skeleton tabIndex={0} />;

    expect(skeleton.props.tabIndex).toBe(0);
  });
});
