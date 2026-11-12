import { existsSync, readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
const landingRouteFile = (name: string) => new URL(`./${name}`, import.meta.url);
const rootRouteFile = (name: string) => new URL(`../${name}`, import.meta.url);

describe('landing route group', () => {
  it('keeps the root URL route and its recovery boundaries inside a URL-neutral group', () => {
    expect(existsSync(landingRouteFile('page.tsx'))).toBe(true);
    expect(existsSync(landingRouteFile('loading.tsx'))).toBe(false);
    expect(existsSync(landingRouteFile('error.tsx'))).toBe(true);

    expect(existsSync(rootRouteFile('page.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('loading.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('error.tsx'))).toBe(false);

    for (const publicLoading of [
      'cookies/loading.tsx',
      'help/contact/loading.tsx',
      'help/loading.tsx',
      'help/support/loading.tsx',
      'help/[slug]/loading.tsx',
      'privacy/loading.tsx',
      'terms/loading.tsx',
      'trust/loading.tsx',
    ]) {
      expect(existsSync(rootRouteFile(publicLoading))).toBe(false);
    }
  });

  it('keeps content visible instead of starting scroll entrance animations', () => {
    const styles = readFileSync(landingRouteFile('home.module.css'), 'utf8');
    const motion = readFileSync(
      new URL('../../components/marketing/home/home-motion.tsx', import.meta.url),
      'utf8',
    );
    for (const entrance of [
      'diagramItemIn',
      'answerPanelIn',
      'citationResolve',
      '[data-home-reveal]',
    ]) {
      expect(styles).not.toContain(entrance);
    }
    expect(motion).not.toContain('revealObserver');
    expect(styles).toContain('animation: evidencePath');
    expect(motion).toContain('pauseAnimations()');
  });

  it('keeps public-page preferences, metadata, and motion usable', () => {
    const styles = readFileSync(landingRouteFile('home.module.css'), 'utf8');
    const agentSetupStyles = readFileSync(
      new URL('../../components/marketing/agents/agent-setup-card.module.css', import.meta.url),
      'utf8',
    );
    const headerStyles = readFileSync(
      new URL('../../components/public-header.module.css', import.meta.url),
      'utf8',
    );
    const motion = readFileSync(
      new URL('../../components/marketing/home/home-motion.tsx', import.meta.url),
      'utf8',
    );
    const narrowViewportStart = headerStyles.indexOf('@media (max-width: 30rem)');
    const narrowViewportEnd = headerStyles.indexOf(
      '@media (prefers-reduced-motion: reduce)',
      narrowViewportStart,
    );
    const narrowViewportStyles = headerStyles.slice(narrowViewportStart, narrowViewportEnd);
    const remFontSizeMinimums = [
      ...styles.matchAll(/font-size:\s*(?:clamp\()?([\d.]+)rem/g),
      ...agentSetupStyles.matchAll(/font-size:\s*(?:clamp\()?([\d.]+)rem/g),
    ].map(([, size]) => Number(size));

    expect(narrowViewportStyles).toContain('.signInLink');
    expect(narrowViewportStyles).toContain('.themeToggle');
    expect(headerStyles).toContain('grid-template-columns: 1fr auto 1fr');
    expect(headerStyles).toContain('min-height: 4rem');
    expect(headerStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('--home-meta-size: 0.75rem');
    expect(Math.min(...remFontSizeMinimums)).toBeGreaterThanOrEqual(0.75);
    expect(agentSetupStyles).toMatch(/\.marks\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.slackMeta span\s*\{[^}]*font-size:\s*var\(--home-meta-size\);/s);
    expect(styles).toMatch(/\.mcpCalls code\s*\{[^}]*font-size:\s*var\(--home-meta-size\);/s);
    expect(styles).not.toContain('translateX(0.35rem)');
    expect(styles).toContain('animation: evidencePath 4.8s linear infinite both');
    expect(styles).toContain('.observatory');
    expect(styles).not.toContain('--diagram-size');
    expect(styles).toContain('animation: flowPacketAcross 8s linear infinite');
    expect(styles).toContain('animation: flowPacketDown 8s linear infinite');
    expect(styles).toContain('@keyframes flowPacketAcross');
    expect(styles).toContain('@keyframes flowPacketDown');
    expect(styles).toMatch(
      /@keyframes flowPacketAcross[\s\S]*translateX\(-100%\)[\s\S]*20%,[\s\S]*translateX\(0\)/u,
    );
    expect(styles).not.toContain('translateX(2.55rem)');
    expect(styles).toContain('@container timeline-flow (min-width: 40rem) and (max-width: 64rem)');
    expect(styles).toContain('@container timeline-flow (max-width: 39.999rem)');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.flowPacketRunner\s*\{[\s\S]*display: none !important;/u,
    );
    expect(styles).toContain('animation: chronologyDraw 1.25s');
    expect(styles).not.toContain('answerPanelIn');
    expect(styles).not.toContain('diagramItemIn');
    expect(styles).not.toContain('citationResolve');
    expect(styles).toContain('animation: trustPathDraw 1.15s');
    expect(styles).not.toContain('ambientSweep');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.evidencePaths path,[\s\S]*animation: none !important;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 44rem\)[\s\S]*\.orbitSourceTime\s*\{\s*display:\s*none;/u,
    );
    expect(styles).toContain('stroke-dashoffset');
    expect(styles).not.toContain(':not(.visible)');
    expect(styles).not.toContain('.motionReady [data-home-diagram] {');
    expect(styles).not.toContain('[data-home-reveal]');
    expect(motion).not.toContain('revealObserver');
    expect(motion).toContain("'[data-home-diagram]'");
    expect(motion).not.toContain('data-home-ambient');
    expect(motion).toContain('classList.toggle(visibleClass, entry.isIntersecting)');
    expect(motion).toContain("addEventListener('change', onChange)");
    expect(motion).toContain("removeEventListener('change', onChange)");
    expect(motion).toContain('setCurrentTime(0)');
    expect(motion).toContain('pauseAnimations()');
    expect(motion).toContain('unpauseAnimations()');
    expect(motion).toContain("'[data-flow-motion]'");
    expect(styles).not.toContain('.ambientTrace');
    expect(styles).toMatch(
      /\.page::before\s*\{[^}]*opacity:\s*0\.055;[^}]*mix-blend-mode:\s*multiply;/s,
    );
    expect(styles).toMatch(
      /:global\(\.dark\) \.page::before\s*\{[^}]*opacity:\s*0\.035;[^}]*mix-blend-mode:\s*normal;/s,
    );
    expect(styles).toContain('.footer a');
    expect(styles).toContain('color: var(--home-paper)');
    expect(styles).toMatch(/\.footerGithub\s*\{[^}]*border: 0 !important;/s);
    expect(styles).toMatch(/\.proofStage\s*\{[^}]*margin-top:\s*2\.75rem;/s);
    expect(styles).toMatch(/\.ledgerInspect\s*\{[^}]*padding:\s*0 1rem 0\.85rem;/s);
    expect(styles).toMatch(
      /\.ledgerInspect summary\s*\{[^}]*width:\s*fit-content;[^}]*list-style:\s*none;/s,
    );
    expect(styles).toContain('.ledgerInspect summary::-webkit-details-marker');
    expect(styles).toContain('.ledgerInspect summary:focus-visible');
    expect(styles).toMatch(
      /\.ledgerInspect\[open\]\s*>\s*summary::before\s*\{[^}]*transform:\s*rotate\(45deg\);/s,
    );
    expect(styles).toMatch(/\.ledgerInspectBody p\s*\{[^}]*font-size:\s*0\.86rem;/s);
  });
});
