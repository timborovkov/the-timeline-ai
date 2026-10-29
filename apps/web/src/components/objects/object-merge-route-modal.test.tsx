import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as objects from '@timeline/shared/objects/types';
import type { ReactNode } from 'react';
const fakes = vi.hoisted(() => ({
  back: vi.fn(),
  refresh: vi.fn(),
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
  mergeCallbacks: undefined as
    | {
        onCancel?: () => void;
        onMerged?: (survivorId: string) => void;
      }
    | undefined,
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: fakes.back, refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/components/objects/object-merge-form'),
  () => ({
    ObjectMergeForm: ({
      onCancel,
      onMerged,
    }: {
      onCancel?: () => void;
      onMerged?: (survivorId: string) => void;
    }) => {
      fakes.mergeCallbacks = { onCancel, onMerged };
      return <div data-testid="object-merge-form" />;
    },
  }),
  () => import('@/components/objects/object-merge-form'),
);
await vi.mock(
  import.meta.resolve('@/components/ui/dialog'),
  () => ({
    Dialog: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      fakes.onOpenChange = onOpenChange;
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  }),
  () => import('@/components/ui/dialog'),
);

const { renderToStaticMarkup } = await import('react-dom/server');

const { ObjectMergeRouteModalForm, ObjectMergeRouteModalFrame } =
  await import('./object-merge-route-modal.js');

const preview: objects.ObjectMergePreview = {
  objects: [],
  survivorId: '00000000-0000-4000-8000-000000000001',
  aliasesToAdd: [],
  factSamplesByObjectId: {},
  counts: { facts: 0, notes: 0, relationships: 0, openTasks: 0 },
  countsBySurvivorId: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.onOpenChange = undefined;
  fakes.mergeCallbacks = undefined;
});

describe('ObjectMergeRouteModalForm', () => {
  it('closes the intercepted route only once when cancel races merge success', () => {
    renderToStaticMarkup(<ObjectMergeRouteModalForm preview={preview} />);

    fakes.mergeCallbacks?.onCancel?.();
    fakes.mergeCallbacks?.onMerged?.(preview.survivorId);

    expect(fakes.back).toHaveBeenCalledTimes(1);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
  });

  it('shares one close guard between dialog dismiss and form callbacks', () => {
    renderToStaticMarkup(
      <ObjectMergeRouteModalFrame title="Review merge">
        <ObjectMergeRouteModalForm preview={preview} />
      </ObjectMergeRouteModalFrame>,
    );

    fakes.mergeCallbacks?.onCancel?.();
    fakes.onOpenChange?.(false);
    fakes.mergeCallbacks?.onMerged?.(preview.survivorId);

    expect(fakes.back).toHaveBeenCalledTimes(1);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
  });
});
