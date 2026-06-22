const ISO_INSTANT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g;

interface DisplayDateOptions {
  timezone?: string;
}

export function formatDisplayDateTime(
  value: Date | string,
  options: DisplayDateOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timezone,
  });
}

export function formatDisplayDate(value: Date | string, options: DisplayDateOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: options.timezone,
  });
}

function formatEmbeddedIsoInstants(text: string, options: DisplayDateOptions): string {
  return text.replace(ISO_INSTANT_PATTERN, (match) => formatDisplayDateTime(match, options));
}

export function displayText(value: string, options: DisplayDateOptions = {}): string {
  return formatEmbeddedIsoInstants(value, options);
}
