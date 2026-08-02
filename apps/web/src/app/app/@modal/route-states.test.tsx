import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ModalDefault from '@/app/app/@modal/default';

describe('authenticated modal default state', () => {
  it('keeps the underlying route as the only announced page when no modal is active', () => {
    const html = renderToStaticMarkup(
      <main>
        <h1>Objects</h1>
        <ModalDefault />
      </main>,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('aria-busy');
  });
});
