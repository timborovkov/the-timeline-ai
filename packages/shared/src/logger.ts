import pino, { type Logger } from 'pino';

let _root: Logger | undefined;

const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent', 'trace', 'fatal']);

function getRoot(): Logger {
  if (_root) return _root;
  // Read directly from process.env rather than going through the validated
  // `getEnv()` schema — the logger must work during Next.js build's
  // "collect page data" phase and in tests where full env isn't set.
  const rawLevel = process.env.LOG_LEVEL ?? 'info';
  const level = LEVELS.has(rawLevel) ? rawLevel : 'info';
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const usePretty = nodeEnv === 'development';
  _root = pino({
    level,
    base: { env: nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
  return _root;
}

function lazy(resolve: () => Logger): Logger {
  return new Proxy({} as Logger, {
    get(_t, prop) {
      const real = resolve() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(real);
      }
      return value;
    },
  });
}

export const logger: Logger = lazy(getRoot);

export function childLogger(component: string, bindings: Record<string, unknown> = {}): Logger {
  return lazy(() => getRoot().child({ component, ...bindings }));
}

export type { Logger };
