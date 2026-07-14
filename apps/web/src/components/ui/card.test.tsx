// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CardTitle } from '@/components/ui/card';

describe('CardTitle', () => {
  it('renders a requested semantic heading', () => {
    render(<CardTitle as="h3">Processing</CardTitle>);
    expect(screen.getByRole('heading', { level: 3, name: 'Processing' })).toBeTruthy();
  });

  it('remains neutral by default', () => {
    const { container } = render(<CardTitle>Summary</CardTitle>);
    expect(container.firstElementChild?.tagName).toBe('DIV');
  });
});
