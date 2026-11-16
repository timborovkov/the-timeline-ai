import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { useState } from 'react';

import { GoogleDriveConnectDisclosure } from '@/components/integrations/google-drive-connect-disclosure';
import { GOOGLE_DRIVE_LIMITED_USE } from '@/lib/google-drive-limited-use';

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <GoogleDriveConnectDisclosure
      open={open}
      onOpenChange={setOpen}
      onContinue={() => {
        setOpen(false);
      }}
    />
  );
}

describe('GoogleDriveConnectDisclosure', () => {
  it('shows Limited Use facts and Continue to Google without a checkbox', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog').getAttribute('data-slot')).toBe(
      'google-drive-connect-disclosure',
    );
    expect(screen.getByRole('heading', { name: GOOGLE_DRIVE_LIMITED_USE.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
    expect(screen.getByRole('button', { name: 'Continue to Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
