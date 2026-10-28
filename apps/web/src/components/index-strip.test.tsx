import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { IndexStrip } from '@/components/index-strip';
// Test environment: happy-dom

describe('IndexStrip', () => {
  it('renders leading navigation before the title and trailing actions after metadata', () => {
    render(
      <IndexStrip
        srLabel="Board · Product Development"
        segments={[{ value: 'BOARD' }, { value: 'Product Development', signal: true }]}
        leading={<span>Back</span>}
        trailing={<button type="button">Actions</button>}
      />,
    );

    const headerText = screen.getByLabelText('Board · Product Development').textContent;
    expect(headerText.indexOf('Back')).toBeLessThan(headerText.indexOf('BOARD'));
    expect(headerText.indexOf('Actions')).toBeGreaterThan(
      headerText.indexOf('Product Development'),
    );
  });
});
