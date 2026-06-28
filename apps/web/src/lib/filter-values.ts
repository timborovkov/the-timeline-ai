export function selectedValues(value: string, options: readonly { value: string }[]): string[] {
  const allowed = new Set(options.map((option) => option.value));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const part = raw.trim();
    if (part && allowed.has(part) && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}
