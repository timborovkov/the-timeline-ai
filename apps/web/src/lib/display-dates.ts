const ISO_INSTANT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g;

export function formatDisplayDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatDisplayDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
}

function formatEmbeddedIsoInstants(text: string): string {
  return text.replace(ISO_INSTANT_PATTERN, (match) => formatDisplayDateTime(match));
}

export function displayText(value: string): string {
  return formatEmbeddedIsoInstants(value);
}
