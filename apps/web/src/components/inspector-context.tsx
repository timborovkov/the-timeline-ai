'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface InspectorContent {
  /** Stable ID for the source being inspected (e.g., "c:1923", "obj:DEAL-204"). */
  id: string;
  /** Short uppercase label shown in the inspector head. */
  kind: string;
  /** Human-readable title shown in the inspector head. */
  title?: string;
  /** Optional content body. If absent, the pane renders a generic "no detail" message. */
  render: () => ReactNode;
}

interface InspectorContextValue {
  open: boolean;
  content: InspectorContent | null;
  show: (content: InspectorContent) => void;
  hide: () => void;
  toggle: () => void;
}

interface InspectorState {
  open: boolean;
  content: InspectorContent | null;
  pathname: string | null;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);
const PORTALED_OVERLAY_SELECTOR = [
  '[role="dialog"]:not(#inspector-pane)',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

function eventCameFromPortaledOverlay(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof Element && target.matches(PORTALED_OVERLAY_SELECTOR));
}

export function InspectorProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<InspectorState>({
    open: false,
    content: null,
    pathname: null,
  });
  const content = state.pathname === pathname ? state.content : null;
  const open = Boolean(content && state.open);

  const show = useCallback(
    (next: InspectorContent) => {
      setState({ open: true, content: next, pathname });
    },
    [pathname],
  );
  const hide = useCallback(() => {
    setState((current) => ({ ...current, open: false }));
  }, []);
  const hideOnEscape = useEffectEvent(() => {
    hide();
  });
  const toggle = useCallback(() => {
    setState((current) =>
      current.content && current.pathname === pathname
        ? { ...current, open: !current.open }
        : current,
    );
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || eventCameFromPortaledOverlay(e)) return;
      e.preventDefault();
      hideOnEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const value = useMemo(
    () => ({ open, content, show, hide, toggle }),
    [open, content, show, hide, toggle],
  );

  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

export function useInspector() {
  const ctx = use(InspectorContext);
  if (!ctx) {
    throw new Error('useInspector must be used inside <InspectorProvider>');
  }
  return ctx;
}
