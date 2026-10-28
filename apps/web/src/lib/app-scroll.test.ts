import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { APP_MAIN_SCROLL_ID, getAppMainScrollElement } from '@/lib/app-scroll';
describe('app scroll', () => {
  it('looks up the shared app main scroller', () => {
    expect(APP_MAIN_SCROLL_ID).toBe('main');
    expect(getAppMainScrollElement()).toBeNull();
  });
});
