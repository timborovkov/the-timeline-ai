import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const landingRouteFile = (name: string) => new URL(`./${name}`, import.meta.url);
const rootRouteFile = (name: string) => new URL(`../${name}`, import.meta.url);

describe('landing route group', () => {
  it('keeps the root URL route and its recovery boundaries inside a URL-neutral group', () => {
    expect(existsSync(landingRouteFile('page.tsx'))).toBe(true);
    expect(existsSync(landingRouteFile('loading.tsx'))).toBe(true);
    expect(existsSync(landingRouteFile('error.tsx'))).toBe(true);

    expect(existsSync(rootRouteFile('page.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('loading.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('error.tsx'))).toBe(false);
  });

  it('keeps public-page preferences, metadata, and motion usable', () => {
    const styles = readFileSync(landingRouteFile('home.module.css'), 'utf8');
    const motion = readFileSync(
      new URL('../../components/marketing/home/home-motion.tsx', import.meta.url),
      'utf8',
    );
    const narrowViewportStart = styles.indexOf('@media (max-width: 22rem)');
    const narrowViewportEnd = styles.indexOf(
      '@media (prefers-reduced-motion: reduce)',
      narrowViewportStart,
    );
    const narrowViewportStyles = styles.slice(narrowViewportStart, narrowViewportEnd);
    const remFontSizeMinimums = [...styles.matchAll(/font-size:\s*(?:clamp\()?([\d.]+)rem/g)].map(
      ([, size]) => Number(size),
    );

    expect(narrowViewportStyles).toContain('.signInLink');
    expect(narrowViewportStyles).not.toContain('.themeToggle');
    expect(styles).toContain('--home-meta-size: 0.75rem');
    expect(Math.min(...remFontSizeMinimums)).toBeGreaterThanOrEqual(0.75);
    expect(styles).not.toContain('translateX(0.35rem)');
    expect(styles).toContain('animation: evidencePath 4.8s ease-in-out infinite both');
    expect(styles).toContain('animation: chronologyDraw 1.25s');
    expect(styles).toContain('animation: answerPanelIn 680ms');
    expect(styles).toContain('animation: trustPathDraw 1.15s');
    expect(styles).toContain('animation: ambientSweep 9s');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).not.toContain('stroke-dashoffset');
    expect(styles).not.toContain(':not(.visible)');
    expect(styles).not.toContain('.motionReady [data-home-diagram] {');
    expect(styles).toContain('.motionReady [data-home-reveal].visible {');
    expect(motion).toContain("'[data-home-ambient], [data-home-diagram]'");
    expect(motion).toContain('classList.toggle(visibleClass, entry.isIntersecting)');
    expect(styles).toContain('.ambientTrace');
    expect(styles).toContain('.footer a');
    expect(styles).toContain('color: var(--home-paper)');
  });
});
