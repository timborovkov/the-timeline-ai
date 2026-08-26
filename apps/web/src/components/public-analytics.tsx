'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  clearPublicAnalyticsConsent,
  getPublicAnalyticsConsentSnapshot,
  parsePublicAnalyticsConsent,
  subscribePublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
import { classifyPublicAnalyticsPath } from '@/lib/public-analytics-routes';
import {
  clearPublicAttributionCookie,
  storeFirstTouchPublicAttribution,
} from '@/lib/public-attribution';
import {
  activatePublicBrowserAnalytics,
  capturePublicCta,
  capturePublicPageView,
  clearLegacyPublicTrackerStorage,
  deactivatePublicBrowserAnalytics,
  isPublicAnalyticsCta,
  isPublicBrowserAnalyticsConfigured,
  pausePublicBrowserAnalytics,
  withdrawPublicBrowserAnalytics,
} from '@/lib/public-browser-analytics';
import { cn } from '@/lib/utils';

const PublicAnalyticsSettingsContext = createContext<(() => void) | undefined>(undefined);
const SERVER_CONSENT_PENDING = null;

function getServerConsentSnapshot(): null {
  return SERVER_CONSENT_PENDING;
}

export function PublicAnalyticsBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const surface = classifyPublicAnalyticsPath(pathname);
  const consentSnapshot = useSyncExternalStore(
    subscribePublicAnalyticsConsent,
    getPublicAnalyticsConsentSnapshot,
    getServerConsentSnapshot,
  );
  const preferenceLoaded = consentSnapshot !== SERVER_CONSENT_PENDING;
  const consent = consentSnapshot ? parsePublicAnalyticsConsent(consentSnapshot) : undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastCapturedPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    clearLegacyPublicTrackerStorage();
    const storedConsent = parsePublicAnalyticsConsent(getPublicAnalyticsConsentSnapshot());
    if (!isPublicBrowserAnalyticsConfigured && storedConsent?.choice === 'accepted') {
      withdrawPublicBrowserAnalytics();
      clearPublicAttributionCookie();
      clearPublicAnalyticsConsent();
    } else if (storedConsent?.choice !== 'accepted') {
      deactivatePublicBrowserAnalytics();
      clearPublicAttributionCookie();
    }
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) {
      lastCapturedPath.current = undefined;
      pausePublicBrowserAnalytics();
      return;
    }
    if (!isPublicBrowserAnalyticsConfigured || consent?.choice !== 'accepted') {
      lastCapturedPath.current = undefined;
      deactivatePublicBrowserAnalytics();
      clearPublicAttributionCookie();
      return;
    }
    if (!surface) {
      lastCapturedPath.current = undefined;
      deactivatePublicBrowserAnalytics();
      return;
    }
    if (!activatePublicBrowserAnalytics(surface)) return;

    storeFirstTouchPublicAttribution(window.location.search);
    if (lastCapturedPath.current !== pathname) {
      lastCapturedPath.current = pathname;
      void capturePublicPageView(surface);
    }

    return pausePublicBrowserAnalytics;
  }, [consent?.choice, pathname, preferenceLoaded, surface]);

  useEffect(() => deactivatePublicBrowserAnalytics, []);

  useEffect(() => {
    if (consent?.choice !== 'accepted' || !surface) return;

    const captureMarkedCta = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const markedElement = event.target.closest<HTMLElement>('[data-public-analytics-cta]');
      const cta = markedElement?.dataset.publicAnalyticsCta;
      if (isPublicAnalyticsCta(cta)) void capturePublicCta(surface, cta);
    };
    document.addEventListener('click', captureMarkedCta, { capture: true });
    return () => {
      document.removeEventListener('click', captureMarkedCta, { capture: true });
    };
  }, [consent?.choice, surface]);

  const acceptAnalytics = useCallback(() => {
    if (!isPublicBrowserAnalyticsConfigured) return;
    writePublicAnalyticsConsent('accepted');
    storeFirstTouchPublicAttribution(window.location.search);
    setSettingsOpen(false);
  }, []);

  const rejectAnalytics = useCallback(() => {
    withdrawPublicBrowserAnalytics();
    clearPublicAttributionCookie();
    writePublicAnalyticsConsent('rejected');
    setSettingsOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  return (
    <PublicAnalyticsSettingsContext value={preferenceLoaded ? openSettings : undefined}>
      {children}
      {preferenceLoaded && isPublicBrowserAnalyticsConfigured && !consent && surface ? (
        <AnalyticsChoiceBanner onAccept={acceptAnalytics} onReject={rejectAnalytics} />
      ) : null}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-border bg-bg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Analytics preferences</DialogTitle>
            <DialogDescription>
              Optional PostHog analytics helps us understand visits and selected actions on public
              pages. It never runs in your private workspace. We separately count personless surface
              requests in broad page categories. Bots and retries can contribute, so those totals
              are not visitor or session metrics.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {!isPublicBrowserAnalyticsConfigured
              ? 'Optional public analytics is unavailable on this deployment.'
              : consent?.choice === 'accepted'
                ? 'Optional public analytics is currently accepted.'
                : consent?.choice === 'rejected'
                  ? 'Optional public analytics is currently rejected.'
                  : 'You have not made an analytics choice yet.'}
          </p>
          <p className="text-sm text-fg-muted">
            Rejecting does not affect public pages, signup, or the app. Read the{' '}
            <Link
              href="/cookies"
              className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              cookies and similar technologies notice
            </Link>
            .
          </p>
          {isPublicBrowserAnalyticsConfigured ? (
            <DialogFooter className="sm:justify-stretch">
              <Button className="flex-1" variant="outline" onClick={rejectAnalytics}>
                Reject analytics
              </Button>
              <Button className="flex-1" variant="outline" onClick={acceptAnalytics}>
                Accept analytics
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </PublicAnalyticsSettingsContext>
  );
}

export function CookieSettingsButton({ className }: { className?: string }) {
  const openSettings = use(PublicAnalyticsSettingsContext);
  if (!openSettings) return null;
  return (
    <button
      type="button"
      className={cn(
        'rounded-sm text-left outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      onClick={openSettings}
    >
      Cookie settings
    </button>
  );
}

function AnalyticsChoiceBanner({
  onAccept,
  onReject,
}: {
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <aside
      aria-labelledby="analytics-choice-title"
      className="fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-3xl rounded-md border border-border bg-bg p-4 shadow-lg sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <h2 id="analytics-choice-title" className="text-base font-semibold text-fg">
            Optional public analytics
          </h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">
            Choose whether PostHog may measure visits and selected actions on public pages. We still
            count personless surface requests in broad page categories. Bots and retries can
            contribute, so those totals are not visitor or session metrics. Rejecting does not
            affect the site or app.{' '}
            <Link
              href="/cookies"
              className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Read the cookies notice
            </Link>
            .
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onReject}>
            Reject
          </Button>
          <Button variant="outline" onClick={onAccept}>
            Accept analytics
          </Button>
        </div>
      </div>
    </aside>
  );
}
