export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

export function renderTurnstileWidget({
  action,
  container,
  reset,
  siteKey,
  turnstile,
}: {
  action: string;
  container: HTMLElement;
  reset: () => void;
  siteKey: string;
  turnstile: TurnstileApi;
}) {
  return turnstile.render(container, {
    sitekey: siteKey,
    action,
    theme: 'light',
    'error-callback': reset,
    'expired-callback': reset,
  });
}
