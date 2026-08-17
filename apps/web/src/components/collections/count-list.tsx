export function CountList({
  empty = 'None yet.',
  items,
}: {
  empty?: string;
  items: {
    danger?: boolean;
    hint?: string;
    key: string;
    label: string;
    value: number | string;
  }[];
}) {
  if (items.length === 0) {
    return <p className="px-1 py-3 text-sm text-fg-muted">{empty}</p>;
  }
  return (
    <ul className="border-y border-border">
      {items.map((item) => {
        const numericZero = typeof item.value === 'number' && item.value === 0;
        const display = typeof item.value === 'number' ? item.value.toLocaleString() : item.value;
        return (
          <li
            key={item.key}
            className="flex min-h-11 items-center justify-between gap-3 px-2 sm:px-3"
          >
            <span className="min-w-0 truncate text-sm text-fg" title={item.hint ?? item.key}>
              {item.label}
            </span>
            <span
              className={
                item.danger
                  ? 'font-mono tabular-nums text-sm text-danger'
                  : numericZero
                    ? 'font-mono tabular-nums text-sm text-fg-muted'
                    : 'font-mono tabular-nums text-sm text-fg'
              }
            >
              {display}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
