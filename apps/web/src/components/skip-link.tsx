/**
 * Visually hidden until focused. First interactive element on every page.
 * Targets <main id="main"> in the shell.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="fixed left-3 top-3 sr-only rounded-sm border border-border-strong bg-surface p-3 text-sm text-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:p-3"
    >
      Skip to main content
    </a>
  );
}
