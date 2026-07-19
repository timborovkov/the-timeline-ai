import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/objects/object-merge-form', () => ({
  ObjectMergeForm: () => null,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <dialog open aria-label="Review merge">
      {children}
    </dialog>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const { default: MergeObjectModalError } = await import('./error.js');
const { default: MergeObjectModalLoading } = await import('./loading.js');

function renderAlongsideBackground(content: ReactNode) {
  return renderToStaticMarkup(
    <main>
      <h1>Objects</h1>
      {content}
    </main>,
  );
}

describe('intercepted merge route states', () => {
  it('keeps its error inside the modal without adding a second page heading', () => {
    const html = renderAlongsideBackground(
      <MergeObjectModalError error={new Error('preview failed')} reset={vi.fn()} />,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<dialog');
    expect(html).toContain('Couldn’t load merge preview');
  });

  it('keeps its loading state inside the modal without adding a second page heading', () => {
    const html = renderAlongsideBackground(<MergeObjectModalLoading />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="Loading merge preview"');
  });
});
