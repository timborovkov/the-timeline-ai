'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface InspectorContent {
  /** Stable ID for the source being inspected (e.g., "c:1923", "obj:DEAL-204"). */
  id: string;
  /** Short uppercase label shown in the inspector head. */
  kind: string;
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

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<InspectorContent | null>(null);

  const show = useCallback((next: InspectorContent) => {
    setContent(next);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => !o);
  }, []);

  // Close on Escape when the inspector is open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  const value = useMemo(
    () => ({ open, content, show, hide, toggle }),
    [open, content, show, hide, toggle],
  );

  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

export function useInspector() {
  const ctx = useContext(InspectorContext);
  if (!ctx) {
    throw new Error('useInspector must be used inside <InspectorProvider>');
  }
  return ctx;
}
