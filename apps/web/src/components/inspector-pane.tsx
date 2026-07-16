'use client';

import { PanelRightClose, X } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DESKTOP_INSPECTOR_QUERY = '(min-width: 1024px)';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const PORTALED_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

function focusBelongsToPortaledOverlay(pane: HTMLElement): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    !pane.contains(active) &&
    active.closest(PORTALED_OVERLAY_SELECTOR) !== null
  );
}

function subscribeToDesktopInspector(onStoreChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_INSPECTOR_QUERY);
  query.addEventListener('change', onStoreChange);
  return () => {
    query.removeEventListener('change', onStoreChange);
  };
}

function desktopInspectorSnapshot(): boolean {
  return window.matchMedia(DESKTOP_INSPECTOR_QUERY).matches;
}

function serverDesktopInspectorSnapshot(): false {
  return false;
}

/**
 * The persistent right-pane primitive. Mounted once in the shell.
 * Reads from InspectorContext; renders nothing when no content is active.
 */
export function InspectorPane() {
  const inspector = useInspector();
  const closeRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const desktop = useSyncExternalStore(
    subscribeToDesktopInspector,
    desktopInspectorSnapshot,
    serverDesktopInspectorSnapshot,
  );

  useEffect(() => {
    if (inspector.open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !paneRef.current?.contains(active)) {
        restoreFocusRef.current = active;
      }
      closeRef.current?.focus();
      return;
    }

    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, [inspector.open, inspector.content?.id]);

  useEffect(() => {
    if (!inspector.open) return;

    function onKeyDown(event: KeyboardEvent): void {
      const pane = paneRef.current;
      if (!pane || focusBelongsToPortaledOverlay(pane)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        inspector.hide();
        return;
      }
      if (desktop || event.key !== 'Tab') return;

      const focusable = [...pane.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        pane.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !pane.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !pane.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [desktop, inspector]);

  if (!inspector.open || !inspector.content) return null;

  const { kind, title, render } = inspector.content;

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Dismiss inspector"
        className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-sm lg:hidden"
        onClick={inspector.hide}
      />
      <aside
        ref={paneRef}
        id="inspector-pane"
        role={desktop ? undefined : 'dialog'}
        aria-modal={desktop ? undefined : true}
        aria-label="Inspector"
        aria-labelledby="inspector-title"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[min(82dvh,42rem)] flex-col rounded-t-md border-t border-border bg-surface shadow-2xl shadow-black/20',
          'lg:sticky lg:top-0 lg:z-auto lg:h-full lg:max-h-none lg:w-96 lg:shrink-0 lg:self-start lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none',
        )}
        tabIndex={-1}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-baseline gap-2 text-sm text-fg-muted">
            <span className="shrink-0 text-xs">{kind}</span>
            <span className="shrink-0 text-fg-dim">·</span>
            <span
              id="inspector-title"
              title={title ?? 'Inspector'}
              className="min-w-0 truncate font-medium text-fg"
            >
              {title ?? 'Inspector'}
            </span>
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            aria-label="Close inspector"
            onClick={inspector.hide}
            className="size-7"
          >
            <X className="size-3.5" />
          </Button>
        </header>
        <div
          className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-fg-muted"
          aria-live="polite"
        >
          {render()}
        </div>
      </aside>
    </>
  );
}

/**
 * Toggle button for the inspector — used in the top bar / command bar.
 * Hidden below the `lg` breakpoint to match {@link InspectorPane}'s own
 * visibility: tapping a chip on mobile still routes through the
 * provider (so the state stays consistent for when the user resizes
 * up), but there's no visible pane to toggle so the button would be
 * misleading.
 */
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
      className={cn('hidden size-8 lg:inline-flex', className)}
    >
      <PanelRightClose className="size-4" />
    </Button>
  );
}
