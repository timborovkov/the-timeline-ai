import { expect, test } from '@playwright/test';

import { newSignedInContext } from './helpers.js';
import { e2eTeam } from './test-data.js';

for (const width of [320, 1440]) {
  test(`the Home email field copies its full address at ${width}px`, async ({ browser }) => {
    const context = await newSignedInContext(browser, 'owner', {
      viewport: { width, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.goto('/app');

      const section = page.getByRole('region', { name: 'Team email', exact: true });
      const field = section.getByRole('textbox', { name: 'Team email address' });
      const copy = section.getByRole('button', { name: 'Copy team email' });
      await expect(section.getByRole('heading', { name: 'Capture by email' })).toBeVisible();
      await expect(field).toHaveValue(e2eTeam.inboundEmail);
      await expect(copy).toHaveText('');

      const fieldBox = await field.boundingBox();
      const copyBox = await copy.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(copyBox).not.toBeNull();
      expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(copyBox!.x);
      expect(Math.abs(fieldBox!.y - copyBox!.y)).toBeLessThan(1);
      expect(copyBox!.x + copyBox!.width).toBeLessThanOrEqual(width);
      const targetSize = width === 320 ? 44 : 36;
      expect(copyBox!.width).toBeGreaterThanOrEqual(targetSize);
      expect(copyBox!.height).toBeGreaterThanOrEqual(targetSize);

      // The streamed field can be visible before its focus and pointer handlers hydrate.
      await expect
        .poll(
          () =>
            field.evaluate((input: HTMLInputElement) => {
              input.blur();
              input.setSelectionRange(0, 0);
              input.focus();
              return input.selectionEnd;
            }),
          { timeout: 30_000 },
        )
        .toBe(e2eTeam.inboundEmail.length);
      await field.blur();
      await field.hover();
      await copy.hover();
      const tooltip = page.getByRole('tooltip', { name: 'Copy team email', exact: true });
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      await field.focus();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
      await expect(copy).not.toHaveCSS('box-shadow', 'none');
      await expect(tooltip).toBeVisible();

      await page.keyboard.press('Enter');
      await expect(section.getByRole('status')).toHaveText('Copied team email.');
      await expect(copy.locator('.lucide-check')).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(e2eTeam.inboundEmail);
      await expect(section.getByRole('status')).toHaveText('');
      await expect(copy.locator('.lucide-check')).toHaveCSS('opacity', '0');

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: () =>
              Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
          },
        });
      });
      await page.keyboard.press('Space');
      await expect(section.getByRole('status')).toBeVisible();
      await expect(section.getByRole('status')).toHaveText(
        'Could not copy. Try again or select the text and copy it manually.',
      );
      await expect(copy).toBeFocused();
    } finally {
      await context.close();
    }
  });
}
