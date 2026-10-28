import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { CardTitle } from '@/components/ui/card';
// Test environment: happy-dom

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
