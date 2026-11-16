'use client';

import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface AlertInput {
  description: string;
  title?: string;
}

interface ConfirmInput extends AlertInput {
  cancelLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface InputDialogInput extends AlertInput {
  cancelLabel?: string;
  confirmLabel?: string;
  defaultValue?: string;
  inputLabel?: string;
  placeholder?: string;
}

type DialogState =
  | (AlertInput & { kind: 'alert'; resolve: () => void })
  | (ConfirmInput & { kind: 'confirm'; resolve: (confirmed: boolean) => void })
  | (InputDialogInput & { kind: 'input'; resolve: (value: string | null) => void });

export function useAppDialog() {
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState('');

  const alert = useCallback((input: AlertInput) => {
    return new Promise<void>((resolve) => {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setState({ ...input, kind: 'alert', resolve });
    });
  }, []);

  const confirm = useCallback((input: ConfirmInput) => {
    return new Promise<boolean>((resolve) => {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setState({ ...input, kind: 'confirm', resolve });
    });
  }, []);

  const input = useCallback((dialogInput: InputDialogInput) => {
    return new Promise<string | null>((resolve) => {
      setInputValue(dialogInput.defaultValue ?? '');
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setState({ ...dialogInput, kind: 'input', resolve });
    });
  }, []);

  const close = useCallback(
    (confirmed = false, value = inputValue) => {
      setState((current) => {
        if (!current) return null;
        if (current.kind === 'alert') current.resolve();
        else if (current.kind === 'confirm') current.resolve(confirmed);
        else current.resolve(confirmed ? value : null);
        return null;
      });
    },
    [inputValue, setState],
  );

  const node = (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          if (state?.kind === 'input') return;
          event.preventDefault();
          titleRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {state?.title ?? (state?.kind === 'confirm' ? 'Confirm' : 'Notice')}
          </DialogTitle>
          <DialogDescription>{state?.description}</DialogDescription>
        </DialogHeader>
        {state?.kind === 'input' ? (
          <div className="space-y-1">
            {state.inputLabel ? (
              <label className="text-sm font-medium text-fg" htmlFor="app-dialog-input">
                {state.inputLabel}
              </label>
            ) : null}
            <Input
              id="app-dialog-input"
              value={inputValue}
              placeholder={state.placeholder}
              onChange={(event) => {
                setInputValue(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  close(true, event.currentTarget.value);
                }
              }}
            />
          </div>
        ) : null}
        <DialogFooter>
          {state?.kind === 'confirm' || state?.kind === 'input' ? (
            <Button variant="outline" onClick={() => close(false)}>
              {state.cancelLabel ?? 'Cancel'}
            </Button>
          ) : null}
          <Button
            variant={state?.kind === 'confirm' && state.destructive ? 'destructive' : 'default'}
            onClick={() => close(true)}
          >
            {state?.kind === 'confirm' || state?.kind === 'input'
              ? (state.confirmLabel ?? 'Confirm')
              : 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { alert, confirm, input, node };
}
