export type MarketingScreenshotFrame = 'landscape' | 'portrait';

export interface MarketingScreenshotCallout {
  label: string;
  detail: string;
}

export interface MarketingScreenshotSlot {
  file: string;
  alt: string;
  caption: string;
  reshoot?: string;
  frame?: MarketingScreenshotFrame;
  callouts?: readonly MarketingScreenshotCallout[];
}
