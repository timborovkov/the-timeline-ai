'use client';

import { Plus } from 'lucide-react';

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

export function CaptureDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden="true" />
          Capture
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Capture a moment</DialogTitle>
          <DialogDescription>Add a note or source file to your team timeline.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
