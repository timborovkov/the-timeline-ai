// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IndexStrip } from '@/components/index-strip';

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
