'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
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

const AnalyticsSettingsDialog = lazy(() => import('./public-analytics-settings-dialog'));

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

  const showChoiceBanner =
    preferenceLoaded && isPublicBrowserAnalyticsConfigured && !consent && Boolean(surface);

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
      <div className={showChoiceBanner ? 'pb-36 sm:pb-8' : undefined}>{children}</div>
      {showChoiceBanner ? (
        <AnalyticsChoiceBanner
          onAccept={acceptAnalytics}
          onReject={rejectAnalytics}
          onOpenSettings={openSettings}
        />
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <AnalyticsSettingsDialog
            onOpenChange={setSettingsOpen}
            onReject={rejectAnalytics}
            onAccept={acceptAnalytics}
            choice={consent?.choice}
          />
        </Suspense>
      ) : null}
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
  onOpenSettings,
}: {
  onAccept: () => void;
  onReject: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside
      aria-labelledby="analytics-choice-title"
      data-analytics-choice-banner
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-3xl rounded-md border border-border bg-bg p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:left-auto sm:mx-0 sm:max-w-sm sm:p-4"
    >
      <div className="grid gap-4">
        <div>
          <h2 id="analytics-choice-title" className="text-base font-semibold text-fg">
            Optional public analytics
          </h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">
            Optional analytics helps us understand visits and selected actions on public pages. It
            also measures referring sites and popular pages.{' '}
            <button
              type="button"
              className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={onOpenSettings}
            >
              Cookie settings
            </button>
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
