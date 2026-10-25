/**
 * Flatten an unknown thrown value into a single log-safe string.
 *
 * Railway's log text view drops Pino structured fields, so `log.warn({ err })`
 * shows only the message. Callers should put this string in the message text.
 * Secrets, tokens, and Telegram bot credentials are redacted.
 */

const SECRET_PATTERN =
  /(?:bot)\d+:[A-Za-z0-9_-]+|(?:Bearer|token)\s+\S+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|whsec_[A-Za-z0-9+/=_-]+/gi;

const CAUSE_KEYS = ['code', 'errno', 'syscall', 'address', 'port', 'hostname', 'host'] as const;

function redactSecrets(value: string): string {
  return value.replace(SECRET_PATTERN, '<redacted>');
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function formatOne(err: unknown): string {
  if (err === undefined) return 'undefined';
  if (err === null) return 'null';
  const scalar = scalarText(err);
  if (scalar !== null) return scalar;
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name);
    if (err.message) parts.push(err.message);
  } else {
    parts.push(Object.prototype.toString.call(err));
  }
  const record = recordValue(err);
  if (record) {
    for (const key of CAUSE_KEYS) {
      const value = scalarText(record[key]);
      if (!value) continue;
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(' ');
}

export function formatErrorCause(err: unknown, depth = 0): string {
  if (depth > 6) return '…';
  const head = formatOne(err);
  const record = recordValue(err);
  const cause = record && 'cause' in record ? record.cause : undefined;
  const chain =
    cause === undefined ? head : `${head} [cause: ${formatErrorCause(cause, depth + 1)}]`;
  return redactSecrets(chain);
}
