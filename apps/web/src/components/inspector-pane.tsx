'use client';

import { PanelRightClose } from 'lucide-react';

import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** A modal reading panel that never takes width from the underlying workspace. */
export function InspectorPane() {
  const inspector = useInspector();
  if (!inspector.content) return null;
  const { kind, title, render } = inspector.content;
  return (
    <Sheet
      open={inspector.open}
      onOpenChange={(open) => {
        if (!open) inspector.hide();
      }}
    >
      <SheetContent
        id="inspector-pane"
        aria-label="Inspector"
        aria-describedby={undefined}
        closeLabel="Close inspector"
      >
        <SheetHeader>
          <p className="text-xs text-fg-dim">{kind}</p>
          <SheetTitle>{title ?? 'Inspector'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="text-sm leading-relaxed text-fg-muted" aria-live="polite">
          {render()}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function InspectorToggle({ className }: { className?: string }) {
  const inspector = useInspector();
  // No content yet → nothing to toggle into. Disable the button rather
  // than flipping `open` to true with an empty pane, which would leave
  // the toggle showing pressed/closed-label with no visible UI change.
  if (!inspector.content) return null;
  const label = inspector.open ? 'Close inspector' : 'Open inspector';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={inspector.open}
      onClick={inspector.toggle}
      className={cn('size-8', className)}
    >
      <PanelRightClose className="size-4" />
    </Button>
  );
}
