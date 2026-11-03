import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

import { PaygValueNudge } from '@/components/payg-value-nudge';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('remembers dismissal for this user/team without hiding another team suggestion', () => {
  const view = render(<PaygValueNudge storageKey="test:user:team-a" />);
  expect(
    screen.getByRole('link', { name: 'Explore Pay as you go' }).getAttribute('href'),
  ).toContain('plan=payg');
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('complementary')).toBeNull();
  view.unmount();
  const same = render(<PaygValueNudge storageKey="test:user:team-a" />);
  expect(screen.queryByRole('complementary')).toBeNull();
  same.unmount();
  render(<PaygValueNudge storageKey="test:user:team-b" />);
  expect(screen.getByRole('complementary')).toBeTruthy();
});
