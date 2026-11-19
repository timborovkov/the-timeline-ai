export function capturedFileFilters(
  source: string | null | undefined,
  sender: string | null | undefined,
) {
  const sources = (source ?? '')
    .split(',')
    .filter((item) => /^[a-z_]{1,40}$/.test(item))
    .slice(0, 12);
  return { sources, sender: (sender ?? '').trim().slice(0, 160) };
}
