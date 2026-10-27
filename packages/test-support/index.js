import { mock, jest, setSystemTime, expect as bunExpect } from 'bun:test';
import { fileURLToPath } from 'node:url';
// Bun's resolves/rejects currently do not assimilate non-Promise thenables
// (including Drizzle queries). Preserve the original suite's Promise contract.
export const expect = new Proxy(bunExpect, {
  get(target, key) {
    // Jest/Vitest interpret string patterns as regular expressions; Bun treats
    // them literally. Compile them explicitly to preserve existing assertions.
    if (key === 'stringMatching') {
      return (pattern) =>
        target.stringMatching(typeof pattern === 'string' ? new RegExp(pattern) : pattern);
    }
    return Reflect.get(target, key, target);
  },
  apply(target, receiver, args) {
    const actual = args[0];
    const thenable = actual && typeof actual.then === 'function';
    function wrap(matcher, modifiers = []) {
      return new Proxy(matcher, {
        get(result, key) {
          if (key === 'not' || key === 'resolves' || key === 'rejects') {
            const nextModifiers = [...modifiers, key];
            let next = bunExpect(
              thenable && nextModifiers.some((modifier) => modifier !== 'not')
                ? Promise.resolve(actual)
                : actual,
            );
            for (const modifier of nextModifiers) next = next[modifier];
            return wrap(next, nextModifiers);
          }
          if (key === 'toMatchObject') {
            // Bun currently rewrites nested arrays while matching subsets. Do
            // not let an assertion mutate the subject of later assertions.
            return (...expected) => {
              const value =
                thenable && modifiers.some((modifier) => modifier !== 'not')
                  ? Promise.resolve(actual).then(
                      (value) => cloneMatchInput(value),
                      (error) => Promise.reject(cloneMatchInput(error)),
                    )
                  : cloneMatchInput(actual);
              let assertion = bunExpect(value);
              for (const modifier of modifiers) assertion = assertion[modifier];
              return assertion.toMatchObject(...expected);
            };
          }
          const value = Reflect.get(result, key);
          return typeof value === 'function' ? value.bind(result) : value;
        },
      });
    }
    return wrap(Reflect.apply(target, receiver, args));
  },
});

// Preserve prototypes, accessors, symbols and cycles of plain data containers;
// opaque runtime instances and functions retain their original identities.
function cloneMatchInput(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : Object.create(prototype);
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if ('value' in descriptor) descriptor.value = cloneMatchInput(descriptor.value, seen);
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

import { withGlobal } from '@sinonjs/fake-timers';
let clock;

// Explicit compatibility helpers for existing assertions. Module registration is
// awaited by callers; no source-transform or implicit mock hoisting is involved.
const globals = new Map();
const environment = new Map();
let generation = 0;
const remember = (map, target, key) => {
  if (!map.has(key)) map.set(key, Object.getOwnPropertyDescriptor(target, key));
};
const restore = (map, target) => {
  for (const [key, descriptor] of map) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  }
  map.clear();
};
export const vi = {
  ...jest,
  mocked: (value) => value,
  hoisted: (factory) => factory(),
  async mock(id, factory, original) {
    if (factory.constructor.name === 'AsyncFunction') {
      // Partial mocks must read the original before replacing its module.
      const exports = await factory(original);
      mock.module(id, () => exports);
    } else {
      mock.module(id, () => factory(original));
    }
  },
  useFakeTimers(options = {}) {
    clock?.uninstall();
    clock = withGlobal(globalThis).install({
      ...options,
      toFake: options.toFake ?? [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
      ],
    });
  },
  useRealTimers() {
    clock?.uninstall();
    clock = undefined;
    setSystemTime();
  },
  setSystemTime(value) {
    if (clock) clock.setSystemTime(value);
    else setSystemTime(value);
  },
  advanceTimersByTime(milliseconds) {
    clock.tick(milliseconds);
  },
  runAllTimers() {
    clock.runAll();
  },
  runOnlyPendingTimers() {
    clock.runToLast();
  },
  getTimerCount() {
    return clock?.countTimers() ?? 0;
  },
  clearAllTimers() {
    if (clock) {
      const now = clock.now;
      clock.reset();
      clock.setSystemTime(now);
    }
  },
  advanceTimersToNextTimer() {
    clock.next();
  },
  isFakeTimers() {
    return Boolean(clock);
  },
  stubGlobal(key, value) {
    remember(globals, globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  },
  unstubAllGlobals() {
    restore(globals, globalThis);
  },
  stubEnv(key, value) {
    remember(environment, process.env, key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  },
  unstubAllEnvs() {
    restore(environment, process.env);
  },
  resetModules() {
    generation++;
  },
  async advanceTimersByTimeAsync(milliseconds) {
    await clock.tickAsync(milliseconds);
  },
  async runAllTimersAsync() {
    await clock.runAllAsync();
  },
  async waitFor(assertion, options = {}) {
    const timeout = typeof options === 'number' ? options : (options.timeout ?? 1000);
    const interval = typeof options === 'number' ? 20 : (options.interval ?? 20);
    const started = performance.now();
    for (;;) {
      try {
        return await assertion();
      } catch (error) {
        if (performance.now() - started >= timeout) throw error;
        if (clock) await clock.tickAsync(interval);
        else await Bun.sleep(interval);
      }
    }
  },
};
// Callers resolve URLs relative to their own module. Cache busting applies only
// to modules explicitly re-imported by a test, never to shared mock modules.
export function freshModuleUrl(url) {
  const result = new URL(url);
  result.searchParams.set('testGeneration', String(generation));
  return fileURLToPath(result) + result.search;
}
