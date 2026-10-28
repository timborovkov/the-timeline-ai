import type { jest, Mock, Matchers } from 'bun:test';
import type { Config } from '@sinonjs/fake-timers';
export type { Mock } from 'bun:test';
type Callable = (...args: any[]) => any;
type Mocked<T> = T extends Callable ? Mock<T> : T;
export declare const vi: Omit<typeof jest, 'mock' | 'spyOn' | 'useFakeTimers'> & {
  spyOn<T extends object, K extends keyof T>(
    object: T,
    key: K,
  ): T[K] extends Callable ? Mock<(...args: Parameters<T[K]>) => ReturnType<T[K]>> : never;
  useFakeTimers(options?: Config): void;
  mocked<T>(value: T, options?: unknown): Mocked<T>;
  hoisted<T>(factory: () => T): T;
  mock(
    id: string,
    factory: (original: <T>() => Promise<T>) => unknown,
    original?: () => Promise<unknown>,
  ): Promise<void>;
  setSystemTime(value?: Date | number): void;
  stubGlobal(key: string, value: unknown): void;
  unstubAllGlobals(): void;
  stubEnv(key: string, value: string | undefined): void;
  unstubAllEnvs(): void;
  resetModules(): void;
  advanceTimersByTimeAsync(milliseconds: number): Promise<void>;
  runAllTimersAsync(): Promise<void>;
  waitFor<T>(
    assertion: () => T | Promise<T>,
    options?: number | { timeout?: number; interval?: number },
  ): Promise<T>;
};
export declare function freshModuleUrl(url: string): string;

// Vitest accepted arbitrary expected values (including negative assertions).
// Preserve that contract while executing Bun's unchanged runtime matchers.
type AsyncMatchers = {
  [
    K in keyof Omit<Matchers<unknown>, 'not' | 'resolves' | 'rejects'>
  ]: Matchers<unknown>[K] extends (...args: infer A) => unknown
    ? (...args: A) => Promise<void>
    : Matchers<unknown>[K];
} & { not: AsyncMatchers };
type CompatibleMatchers = Omit<Matchers<unknown>, 'not' | 'resolves' | 'rejects'> & {
  not: CompatibleMatchers;
  resolves: AsyncMatchers;
  rejects: AsyncMatchers;
};
export declare const expect: {
  <T = unknown>(value: T, message?: string): CompatibleMatchers;
} & Pick<typeof import('bun:test').expect, keyof typeof import('bun:test').expect>;
