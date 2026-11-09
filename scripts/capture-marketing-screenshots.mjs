/**
 * Recapture public marketing screenshot light/dark pairs from a seeded demo.
 *
 * Prerequisites: exported root `.env`, `bun run db:migrate`, `bun run demo:seed`
 * (or `dev:seed`), and the web app on CAPTURE_BASE_URL (default localhost:3000).
 * Signs in as owner@timeline.dev. Writes 2880×1800 desktop and 780×1688 mobile
 * RGB PNGs to CAPTURE_OUT_DIR (default /tmp/marketing-screenshots).
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { chromium } from '@playwright/test';

const BASE_URL = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? '/tmp/marketing-screenshots';
const EMAIL = 'owner@timeline.dev';
const PASSWORD = 'timeline-dev';

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };

/** @typedef {{ stem: string, path: string, wait: string | RegExp, prepare?: (page: import('@playwright/test').Page) => Promise<void>, afterStabilize?: (page: import('@playwright/test').Page) => Promise<void>, mobile?: boolean }} Shot */

/** @type {Shot[]} */
const DESKTOP_SHOTS = [
  {
    stem: '11-timeline',
    path: '/app/timeline',
    wait: /TODAY|Today/,
  },
  {
    stem: '12-timeline-slack',
    path: '/app/timeline?source=slack&mode=events',
    wait: /Slack|#product|#eng|#hiring/i,
  },
  {
    stem: '14-timeline-email',
    path: '/app/timeline?source=email&mode=events&event=92000000-0000-4000-8000-000000000003',
    wait: /Source evidence|Northwind Capital|Original email/,
  },
  {
    stem: '15-timeline-meeting',
    path: '/app/timeline?source=meeting&mode=events',
    wait: /Open transcript|Daily product standup|Meeting/,
  },
  {
    stem: '17-timeline-voice',
    path: '/app/timeline?source=telegram&mode=events&event=92000000-0000-4000-8000-000000000fa1',
    wait: /Voice memo|Source evidence|0:00/,
  },
  {
    stem: '18-sources',
    path: '/app/connections/sources',
    wait: /Connected providers|Telegram|Google Drive/,
  },
  {
    stem: '19-agent-tools',
    path: '/app/connections/agent-tools',
    wait: /Agent access|Timeline MCP|Coming soon/,
    prepare: collapseComingSoon,
  },
  {
    stem: '22-client-northstar',
    path: '/app/objects/a4000000-0000-4000-8000-000000000001',
    wait: /Northstar Works/,
  },
  {
    stem: '23-project-northstar',
    path: '/app/objects/a3000000-0000-4000-8000-000000000001',
    wait: /Northstar pilot/,
  },
  {
    stem: '24-task-northstar',
    path: '/app/objects/a3000000-0000-4000-8000-000000000002',
    wait: /Validate Northstar pilot export/,
  },
  {
    stem: '25-tasks',
    path: '/app/tasks?view=list',
    wait: /Open \d+|In progress|Tasks/,
  },
  {
    stem: '27-board-dealflow',
    path: '/app/boards/b1000000-0000-4000-8000-000000000001',
    wait: /Customer dealflow|Helio Retail|Northstar Works/,
  },
  {
    stem: '29-approvals',
    path: '/app/approvals?status=pending',
    wait: /Pending|Why this was suggested/,
  },
  {
    stem: '31-ask-status',
    path: '/app/chat?session=ab000000-0000-4000-8000-000000000002',
    wait: /Northstar status|current status of the Northstar/,
  },
  {
    stem: '32-ask-handoff',
    path: '/app/chat?session=ab000000-0000-4000-8000-000000000009',
    wait: /Northstar handoff brief|handoff brief for the incoming owner/,
    prepare: filterHandoffSidebar,
    afterStabilize: hoverHandoffCitation,
  },
  {
    stem: '33-digest',
    path: '/app/digests?digest=ac000000-0000-4000-8000-000000000014',
    wait: /Highlights|Follow-ups/,
    prepare: resetDigestScroll,
  },
  {
    stem: '35b-meeting-northstar',
    path: '/app/meetings/55000000-0000-4000-8000-000000000001',
    wait: /Northstar pilot handoff review|Transcript/,
  },
  {
    stem: '44-work',
    path: '/app/work',
    wait: /Pinned|Northstar pilot|Customer dealflow/,
  },
];

/** @type {Shot[]} */
const MOBILE_SHOTS = [
  {
    stem: '53-timeline-mobile',
    path: '/app/timeline',
    wait: /TODAY|Today/,
    mobile: true,
  },
  {
    stem: '54-ask-recap-mobile',
    path: '/app/chat?session=ab000000-0000-4000-8000-000000000001',
    wait: /What did the team achieve recently\?|Recent activity recap/,
    mobile: true,
  },
];

async function collapseComingSoon(page) {
  const button = page.getByRole('button', { name: /Coming soon/i }).first();
  if ((await button.count()) === 0) return;
  if ((await button.getAttribute('aria-expanded')) === 'true') {
    await button.click();
    await page.waitForTimeout(200);
  }
}

async function filterHandoffSidebar(page) {
  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await search.waitFor({ state: 'visible', timeout: 15_000 });
  await search.fill('handoff');
  await page.getByText('Northstar handoff brief', { exact: false }).first().waitFor({
    timeout: 10_000,
  });
  // Recap should drop out of the filtered sidebar.
  await page.waitForTimeout(300);
}

async function hoverHandoffCitation(page) {
  // Hover after stabilize(); stabilize() moves the pointer to 0,0.
  const marker = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: /^2$/ }).first();
  await marker.waitFor({ state: 'visible', timeout: 10_000 });
  await marker.hover();
  await page.getByRole('dialog').waitFor({ timeout: 8_000 });
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[role="dialog"]');
      const text = node?.textContent ?? '';
      return text.length > 0 && !text.includes('Loading citation');
    },
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
}

async function resetDigestScroll(page) {
  // `?digest=` scrolls the inner overflow pane, not the window.
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate(() => {
      document.querySelectorAll('.overflow-y-auto, .overflow-x-hidden').forEach((el) => {
        el.scrollTop = 0;
      });
      window.scrollTo(0, 0);
      document.querySelector('nextjs-portal')?.remove();
    });
    if (await page.getByRole('heading', { name: /Digests/i }).isVisible()) {
      break;
    }
    await page.waitForTimeout(150);
  }
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

async function stabilize(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document.querySelector('nextjs-portal')?.remove();
  });
  await page.mouse.move(0, 0);
}

async function captureShot(page, shot, theme) {
  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const waiter =
    typeof shot.wait === 'string'
      ? page.getByText(shot.wait, { exact: false }).first()
      : page.getByText(shot.wait).first();
  await waiter.waitFor({ timeout: 30_000 });
  if (shot.prepare) await shot.prepare(page);
  await stabilize(page);
  if (shot.afterStabilize) await shot.afterStabilize(page);
  await page.waitForTimeout(400);
  const htmlClass = await page.locator('html').getAttribute('class');
  const isDark = (htmlClass ?? '').split(/\s+/).includes('dark');
  if (theme === 'dark' && !isDark) {
    throw new Error(`${shot.stem}: expected dark class, got ${htmlClass}`);
  }
  if (theme === 'light' && isDark) {
    throw new Error(`${shot.stem}: expected light html, got ${htmlClass}`);
  }
  const dest = join(OUT_DIR, `${shot.stem}-${theme}.png`);
  mkdirSync(dirname(dest), { recursive: true });
  await page.screenshot({
    path: dest,
    fullPage: false,
    animations: 'disabled',
    type: 'png',
  });
  console.log(`captured ${shot.stem}-${theme}.png html=${htmlClass}`);
}

async function runTheme(browser, theme, shots, viewport) {
  const context = await browser.newContext({
    colorScheme: theme,
    reducedMotion: 'reduce',
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    baseURL: BASE_URL,
  });
  await context.addInitScript((value) => {
    window.localStorage.setItem('tl-theme', value);
  }, theme);
  const page = await context.newPage();
  try {
    await signIn(page);
    for (const shot of shots) {
      try {
        await captureShot(page, shot, theme);
      } catch (error) {
        console.error(`FAILED ${shot.stem}-${theme}:`, error);
        const dest = join(OUT_DIR, `${shot.stem}-${theme}.FAILED.png`);
        await page.screenshot({ path: dest, fullPage: true }).catch(() => {});
        throw error;
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const theme of ['dark', 'light']) {
      await runTheme(browser, theme, DESKTOP_SHOTS, DESKTOP);
    }
    for (const theme of ['dark', 'light']) {
      await runTheme(browser, theme, MOBILE_SHOTS, MOBILE);
    }
  } finally {
    await browser.close();
  }

  // Keep unthemed mobile files in sync with the dark recapture.
  for (const stem of ['53-timeline-mobile', '54-ask-recap-mobile']) {
    const dark = join(OUT_DIR, `${stem}-dark.png`);
    const unthemed = join(OUT_DIR, `${stem}.png`);
    if (existsSync(dark)) copyFileSync(dark, unthemed);
  }
  console.log('done', OUT_DIR);
}

await main();
