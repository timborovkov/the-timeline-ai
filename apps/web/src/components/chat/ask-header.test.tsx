import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AskHeader } from '@/components/chat/ask-header';

describe('AskHeader', () => {
  it('keeps the Ask heading and places the selected title on the same row', () => {
    const html = renderToStaticMarkup(
      <AskHeader activeTitle="August work sessions and recap" teamName="AuditAI" />,
    );

    expect(html).toContain('>Ask</h1>');
    expect(html).toContain('August work sessions and recap');
    expect(html).toContain('items-baseline');
    expect(html).not.toContain('session count');
    expect(html).not.toMatch(/\d+ sessions?/);
  });

  it('omits a title when starting a new chat', () => {
    const html = renderToStaticMarkup(<AskHeader activeTitle={null} teamName="AuditAI" />);

    expect(html).toContain('Chat with AuditAI&#x27;s timeline');
    expect(html).not.toContain('<p');
  });
});
