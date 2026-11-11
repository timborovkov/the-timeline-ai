'use client';

import { Plus, Video } from 'lucide-react';
import { useState } from 'react';

import type { ComponentProps } from 'react';

import { SavedMeetingForm, ScheduleMeetingBotForm } from '@/components/meeting-forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function MeetingCreateDialog({
  kind,
  ...formProps
}: Omit<ComponentProps<typeof SavedMeetingForm>, 'onSuccess'> & {
  kind: 'captures' | 'saved';
}) {
  const [open, setOpen] = useState(false);
  const isCapture = kind === 'captures';
  const title = isCapture ? 'Invite notetaker' : 'Save a meeting';
  const Icon = isCapture ? Video : Plus;
  const close = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Icon aria-hidden="true" className="size-4" />
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isCapture
              ? 'Add a meeting link to capture its transcript and follow-up context.'
              : 'Keep a meeting link and its recurring schedule ready for future calls.'}
          </DialogDescription>
        </DialogHeader>
        {isCapture ? (
          <ScheduleMeetingBotForm {...formProps} onSuccess={close} />
        ) : (
          <SavedMeetingForm {...formProps} onSuccess={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
