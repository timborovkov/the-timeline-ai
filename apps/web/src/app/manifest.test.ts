import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';

describe('web app manifest', () => {
  it('launches into the workspace with PNG home-screen icons', () => {
    const result = manifest();

    expect(result.name).toBe('The Timeline');
    expect(result.id).toBe('/');
    expect(result.start_url).toBe('/app');
    expect(result.display).toBe('standalone');
    expect(result.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        }),
        expect.objectContaining({
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        }),
        expect.objectContaining({
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        }),
      ]),
    );
  });
});
