import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ChatLoading from '@/app/app/chat/loading';

describe('ChatLoading', () => {
  it('hides the desktop session rail and mirrors the mobile session control', () => {
    const html = renderToStaticMarkup(<ChatLoading />);

    expect(html).toContain('hidden h-full w-60');
    expect(html).toContain('md:hidden');
    expect(html).toContain('min-w-0');
  });
});
