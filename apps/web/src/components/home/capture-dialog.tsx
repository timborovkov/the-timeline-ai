'use client';

import { Plus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function subscribeToLocation(onStoreChange: () => void): () => void {
  window.addEventListener('hashchange', onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  return () => {
    window.removeEventListener('hashchange', onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
  };
}

function captureHashIsActive(): boolean {
  return window.location.hash === '#capture';
}

function captureHashIsInactive(): false {
  return false;
}

export function CaptureDialog({ children }: { children: ReactNode }) {
  const [openFromTrigger, setOpenFromTrigger] = useState(false);
  const openFromHash = useSyncExternalStore(
    subscribeToLocation,
    captureHashIsActive,
    captureHashIsInactive,
  );

  function setDialogOpen(nextOpen: boolean): void {
    setOpenFromTrigger(nextOpen);
    if (!nextOpen && window.location.hash === '#capture') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  return (
    <Dialog open={openFromTrigger || openFromHash} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button id="capture" variant="outline">
          <Plus aria-hidden="true" />
          Capture
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Capture a moment</DialogTitle>
          <DialogDescription>
            Capture a note, voice recording, or file. Choose team or private visibility before
            posting.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
