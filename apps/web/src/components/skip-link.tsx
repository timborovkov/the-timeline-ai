/**
 * Visually hidden until focused. First interactive element on every page.
 * Targets <main id="main"> in the shell.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:border focus:border-border-strong focus:bg-surface focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:tracking-[0.14em] focus:text-fg"
    >
      Skip to main content
    </a>
  );
}
