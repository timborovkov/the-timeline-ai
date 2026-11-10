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

export function marketingScreenshotVariants(file: string) {
  const stem = file.replace(/(?:-(?:light|dark))?\.png$/, '');
  return { light: `${stem}-light.png`, dark: `${stem}-dark.png` };
}
