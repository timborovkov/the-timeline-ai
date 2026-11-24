import { expect, test } from '@playwright/test';

test('compact agent setup fits and copies at phone widths', async ({ browser }) => {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      colorScheme: width === 320 ? 'dark' : 'light',
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await expect(page.locator('[data-public-session="signed-out"]').first()).toBeAttached();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const section = page.getByRole('region', { name: 'Your agents work from the same record.' });
      const card = section.getByRole('region', { name: 'Get started with your agent' });
      const command = card.locator('code');
      const expected = 'Set up The Timeline - https://thetimeline.cc/llms.txt';
      await expect(command).toHaveText(expected);
      expect(
        await command.evaluate((element) => {
          const text = element.firstChild;
          if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) return 0;
          const range = document.createRange();
          range.setStart(text, text.textContent.indexOf('https:'));
          range.setEnd(text, text.textContent.length);
          return range.getClientRects().length;
        }),
      ).toBe(1);
      const copy = card.getByRole('button', { name: 'Copy setup command' });
      await section.getByRole('link', { name: 'agent’s note' }).focus();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
      await expect(card.getByText('Copied setup command.')).toBeAttached();
      expect((await copy.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await section.getByRole('link', { name: 'Slack report' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#login-source-01$/);
      await expect(page.locator(':target')).toContainText('Login page reported broken');
    } finally {
      await context.close();
    }
  }
});
