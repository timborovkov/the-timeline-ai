'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

declare global {
  interface Window {
    turnstile?: {
      ready(callback: () => void): void;
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
        },
      ): string;
      remove(widgetId: string): void;
      reset(widgetId: string): void;
    };
  }
}

export function TurnstileWidget({ siteKey }: { siteKey?: string }) {
  const { pending } = useFormStatus();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const wasPendingRef = useRef(false);

  const reset = useCallback(() => {
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }, []);

  const render = useCallback(() => {
    if (!siteKey || !containerRef.current || widgetIdRef.current || !window.turnstile) return;
    window.turnstile.ready(() => {
      if (!siteKey || !containerRef.current || widgetIdRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        'error-callback': reset,
        'expired-callback': reset,
      });
    });
  }, [reset, siteKey]);

  useEffect(() => {
    render();
    return () => {
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [render]);

  useEffect(() => {
    if (wasPendingRef.current && !pending) reset();
    wasPendingRef.current = pending;
  }, [pending, reset]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        async
        defer
        onReady={render}
      />
      <div ref={containerRef} />
    </>
  );
}
