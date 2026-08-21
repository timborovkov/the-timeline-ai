// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import styles from '@/app/(landing)/home.module.css';
import { TimelineFlowMotion } from '@/components/marketing/home/timeline-flow-motion';

const MOTION_READY_CLASS = requiredClassName(styles.motionReady, 'motionReady');
const VISIBLE_CLASS = requiredClassName(styles.visible, 'visible');

function requiredClassName(value: string | undefined, name: string): string {
  if (!value) throw new Error(`The home stylesheet is missing ${name}`);
  return value;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  readonly observed = new Set<Element>();
  readonly observe = vi.fn((target: Element) => {
    this.observed.add(target);
  });
  readonly disconnect = vi.fn(() => {
    this.observed.clear();
  });
  readonly unobserve = vi.fn((target: Element) => {
    this.observed.delete(target);
  });

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  trigger(target: Element, isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class FakeReducedMotion {
  matches: boolean;
  readonly listeners = new Set<(event: MediaQueryListEvent) => void>();
  readonly addEventListener = vi.fn(
    (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      this.listeners.add(listener);
    },
  );
  readonly removeEventListener = vi.fn(
    (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      this.listeners.delete(listener);
    },
  );

  constructor(matches = false) {
    this.matches = matches;
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    const event = { matches } as MediaQueryListEvent;
    for (const listener of this.listeners) listener(event);
  }
}

interface FlowFixture {
  readonly root: HTMLElement;
  readonly steps: readonly [HTMLElement, HTMLElement];
  readonly pauseAnimations: ReturnType<typeof vi.fn>;
  readonly unpauseAnimations: ReturnType<typeof vi.fn>;
  readonly setCurrentTime: ReturnType<typeof vi.fn>;
}

function createFlowFixture(): FlowFixture {
  const root = document.createElement('section');
  root.id = 'expanded-flow';

  const firstStep = document.createElement('article');
  firstStep.dataset.flowStep = 'evidence';
  const secondStep = document.createElement('article');
  secondStep.dataset.flowStep = 'timeline';

  const pauseAnimations = vi.fn();
  const unpauseAnimations = vi.fn();
  const setCurrentTime = vi.fn();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.dataset.flowMotion = '';
  Object.assign(svg, { pauseAnimations, unpauseAnimations, setCurrentTime });
  firstStep.append(svg);
  root.append(firstStep, secondStep);
  document.body.append(root);

  return {
    root,
    steps: [firstStep, secondStep],
    pauseAnimations,
    unpauseAnimations,
    setCurrentTime,
  };
}

describe('TimelineFlowMotion', () => {
  let reducedMotion: FakeReducedMotion;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    reducedMotion = new FakeReducedMotion();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => reducedMotion as unknown as MediaQueryList),
    );
  });

  afterEach(() => {
    cleanup();
    document.getElementById('expanded-flow')?.remove();
    vi.unstubAllGlobals();
  });

  it('observes and replays each flow step independently', () => {
    const fixture = createFlowFixture();
    render(<TimelineFlowMotion targetId={fixture.root.id} />);

    const observer = FakeIntersectionObserver.instances[0];
    expect(observer?.options).toEqual({ rootMargin: '0px 0px -18% 0px', threshold: 0.18 });
    expect(observer?.observed).toEqual(new Set(fixture.steps));
    expect(fixture.root.classList.contains(MOTION_READY_CLASS)).toBe(true);
    expect(fixture.steps[0].classList.contains(VISIBLE_CLASS)).toBe(false);
    expect(fixture.steps[1].classList.contains(VISIBLE_CLASS)).toBe(false);

    fixture.pauseAnimations.mockClear();
    observer?.trigger(fixture.steps[0], true);

    expect(fixture.steps[0].classList.contains(VISIBLE_CLASS)).toBe(true);
    expect(fixture.steps[1].classList.contains(VISIBLE_CLASS)).toBe(false);
    expect(fixture.setCurrentTime).toHaveBeenCalledWith(0);
    expect(fixture.unpauseAnimations).toHaveBeenCalledOnce();

    observer?.trigger(fixture.steps[0], true);
    expect(fixture.setCurrentTime).toHaveBeenCalledOnce();

    observer?.trigger(fixture.steps[0], false);
    expect(fixture.steps[0].classList.contains(VISIBLE_CLASS)).toBe(false);
    expect(fixture.pauseAnimations).toHaveBeenCalledOnce();
  });

  it('cleans up active motion and recreates observers when the preference changes', () => {
    const fixture = createFlowFixture();
    const view = render(<TimelineFlowMotion targetId={fixture.root.id} />);
    const firstObserver = FakeIntersectionObserver.instances[0];
    firstObserver?.trigger(fixture.steps[0], true);

    reducedMotion.setMatches(true);

    expect(firstObserver?.disconnect).toHaveBeenCalledOnce();
    expect(fixture.root.classList.contains(MOTION_READY_CLASS)).toBe(false);
    expect(fixture.steps[0].classList.contains(VISIBLE_CLASS)).toBe(false);
    expect(fixture.pauseAnimations).toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    reducedMotion.setMatches(false);

    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(fixture.root.classList.contains(MOTION_READY_CLASS)).toBe(true);
    expect(fixture.steps[0].classList.contains(VISIBLE_CLASS)).toBe(false);

    view.unmount();
    expect(reducedMotion.listeners.size).toBe(0);
    expect(fixture.root.classList.contains(MOTION_READY_CLASS)).toBe(false);
  });

  it('shows and starts every step when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const fixture = createFlowFixture();

    render(<TimelineFlowMotion targetId={fixture.root.id} />);

    expect(fixture.root.classList.contains(MOTION_READY_CLASS)).toBe(true);
    expect(fixture.steps.every((step) => step.classList.contains(VISIBLE_CLASS))).toBe(true);
    expect(fixture.setCurrentTime).toHaveBeenCalledWith(0);
    expect(fixture.unpauseAnimations).toHaveBeenCalledOnce();
  });
});
