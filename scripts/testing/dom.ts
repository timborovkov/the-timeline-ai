import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach, jest } from 'bun:test';
import { vi } from '@timeline/test-support';

Object.assign(jest, {
  advanceTimersByTime: vi.advanceTimersByTime,
  runOnlyPendingTimers: vi.runOnlyPendingTimers,
});
Object.assign(globalThis, { jest: vi });
GlobalRegistrator.register({ url: 'http://localhost:3000' });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
await import('./happy-dom-react-form-actions');
const { cleanup } = await import('@testing-library/react');
afterEach(cleanup);
