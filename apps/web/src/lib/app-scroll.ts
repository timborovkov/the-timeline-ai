export const APP_MAIN_SCROLL_ID = 'main';

export function getAppMainScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(APP_MAIN_SCROLL_ID);
}
