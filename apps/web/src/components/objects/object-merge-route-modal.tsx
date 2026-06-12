'use client';

import { useRouter } from 'next/navigation';
import { createContext, use, useRef } from 'react';

import type * as objects from '@timeline/shared/objects';
import type { ReactNode } from 'react';

import { ObjectMergeForm } from '@/components/objects/object-merge-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FrameProps {
  children: ReactNode;
  description?: string;
  title: string;
}

interface FormProps {
  preview: objects.ObjectMergePreview;
  suggestionItemId?: string;
}

const ObjectMergeRouteModalCloseContext = createContext<(() => boolean) | null>(null);

export function ObjectMergeRouteModalFrame({ children, description, title }: FrameProps) {
  const router = useRouter();
  const closedRef = useRef(false);

  function close(): boolean {
    if (closedRef.current) return false;
    closedRef.current = true;
    router.back();
    return true;
  }

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <ObjectMergeRouteModalCloseContext.Provider value={close}>
          {children}
        </ObjectMergeRouteModalCloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

export function ObjectMergeRouteModalForm({ preview, suggestionItemId }: FormProps) {
  const router = useRouter();
  const modalClose = use(ObjectMergeRouteModalCloseContext);
  const closedRef = useRef(false);

  function closeRoute(): boolean {
    if (modalClose) {
      return modalClose();
    }
    if (closedRef.current) return false;
    closedRef.current = true;
    router.back();
    return true;
  }

  function handleMerged() {
    closeRoute();
    router.refresh();
  }

  return (
    <ObjectMergeForm
      objects={preview.objects}
      initialSurvivorId={preview.survivorId}
      countsBySurvivorId={preview.countsBySurvivorId}
      factSamplesByObjectId={preview.factSamplesByObjectId}
      suggestionItemId={suggestionItemId}
      onCancel={closeRoute}
      onMerged={handleMerged}
    />
  );
}
