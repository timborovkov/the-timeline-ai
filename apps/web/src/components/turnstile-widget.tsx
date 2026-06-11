'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { renderTurnstileWidget, type TurnstileApi } from '@/lib/turnstile-widget';

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({ action, siteKey }: { action: string; siteKey?: string }) {
  const { pending } = useFormStatus();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const wasPendingRef = useRef(false);

  const reset = useCallback(() => {
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
  }, []);

  const render = useCallback(() => {
    if (!siteKey || !containerRef.current || widgetIdRef.current || !window.turnstile) return;
    widgetIdRef.current = renderTurnstileWidget({
      action,
      container: containerRef.current,
      reset,
      siteKey,
      turnstile: window.turnstile,
    });
  }, [action, reset, siteKey]);

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
