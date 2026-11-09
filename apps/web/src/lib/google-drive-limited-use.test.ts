import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  GOOGLE_DRIVE_LIMITED_USE,
  GOOGLE_DRIVE_LIMITED_USE_POLICY,
  isGoogleDriveProviderId,
} from '@/lib/google-drive-limited-use';

describe('Google Drive Limited Use copy', () => {
  it('names use, storage, sharing, deletion, processors, and no general-model training', () => {
    const blob = Object.values(GOOGLE_DRIVE_LIMITED_USE).join(' ');
    expect(blob).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(blob).toContain('encrypted at rest');
    expect(blob).toContain('does not edit Drive files');
    expect(blob).toContain('Cited timeline events already captured stay in the workspace');
    expect(blob).toContain('Removing your personal Drive account');
    expect(blob).toContain('admin disconnect of the workspace Drive source');
    expect(blob).toContain('document-extract');
    expect(blob).toContain('does not use Google user data to train general-purpose models');
    expect(GOOGLE_DRIVE_LIMITED_USE.policy).toBe(GOOGLE_DRIVE_LIMITED_USE_POLICY);
    expect(isGoogleDriveProviderId('google_drive')).toBe(true);
    expect(isGoogleDriveProviderId('github')).toBe(false);
  });
});
