'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface CommandBarProps {
  /** Mono right-aligned hint, e.g. "team · acme". */
  hint?: string;
  /** Override placeholder text. */
  placeholder?: string;
  className?: string;
}

/**
 * Persistent ⌘K command/search bar at the top of every authenticated screen.
 * Submitting routes to /app/timeline?q=... (until a richer palette ships).
 */
export function CommandBar({
  hint,
  placeholder = 'Ask, jump, capture, or search…',
  className,
}: CommandBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  // ⌘K / Ctrl+K focuses the bar from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;
        router.push(`/app/timeline?q=${encodeURIComponent(q)}`);
      }}
      className={cn(
        'flex h-10 flex-1 items-center gap-2 rounded-sm border border-border bg-surface px-3',
        'focus-within:border-border-strong',
        'transition-colors',
        className,
      )}
    >
      <label htmlFor="command-bar-input" className="sr-only">
        Search, ask, jump, or capture
      </label>
      <span
        aria-hidden="true"
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal"
      >
        ⌘K
      </span>
      <Search aria-hidden="true" className="size-3.5 text-fg-dim" />
      <input
        id="command-bar-input"
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-dim focus:outline-none"
      />
      {hint ? (
        <span
          aria-hidden="true"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
        >
          {hint}
        </span>
      ) : null}
    </form>
  );
}
