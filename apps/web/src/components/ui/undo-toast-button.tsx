'use client';

export function UndoToastButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto inline-flex h-6 shrink-0 items-center rounded-sm border border-border bg-surface-2 px-2 text-xs font-medium text-fg hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Undo
    </button>
  );
}
