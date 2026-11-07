export type MarketingScreenshotFrame = 'landscape' | 'portrait';

export interface MarketingScreenshotSlot {
  file: string;
  alt: string;
  caption: string;
  reshoot?: string;
  frame?: MarketingScreenshotFrame;
}
