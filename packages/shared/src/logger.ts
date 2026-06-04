import pino, { type Logger } from 'pino';

let _root: Logger | undefined;
let processPipeErrorHandlersInstalled = false;

const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent', 'trace', 'fatal']);

function isBrokenPipeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; syscall?: unknown };
  return candidate.code === 'EPIPE' || candidate.code === 'ERR_STREAM_DESTROYED';
}

function ignoreBrokenPipeError(err: unknown): void {
  if (isBrokenPipeError(err)) return;
  throw err;
}

function installProcessPipeErrorHandlers(): void {
  if (processPipeErrorHandlersInstalled) return;
  processPipeErrorHandlersInstalled = true;
  process.stdout.on('error', ignoreBrokenPipeError);
  process.stderr.on('error', ignoreBrokenPipeError);
}

function getRoot(): Logger {
  if (_root) return _root;
  installProcessPipeErrorHandlers();
  // Read directly from process.env rather than going through the validated
  // `getEnv()` schema — the logger must work during Next.js build's
  // "collect page data" phase and in tests where full env isn't set.
  const rawLevel = process.env.LOG_LEVEL ?? 'info';
  const level = LEVELS.has(rawLevel) ? rawLevel : 'info';
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const usePretty =
    nodeEnv === 'development' && level !== 'silent' && process.env.LOG_PRETTY === 'true';
  const options = {
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
  };
  if (usePretty) {
    _root = pino(options);
  } else {
    const destination = pino.destination(1);
    destination.on('error', ignoreBrokenPipeError);
    _root = pino(options, destination);
  }
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
