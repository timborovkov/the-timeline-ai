import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TimelineSourceFilterControls } from '@/components/timeline-source-filter-controls';

describe('TimelineSourceFilterControls', () => {
  it('preserves a selected origin when facet discovery returns no options', () => {
    const html = renderToStaticMarkup(
      <TimelineSourceFilterControls source="" origin="telegram:-1001" originOptions={[]} />,
    );

    expect(html).toContain('name="origin"');
    expect(html).toContain('value="telegram:-1001"');
  });
});
