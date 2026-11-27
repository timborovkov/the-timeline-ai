export const WEBSITE_SCAN_FREQUENCIES = ['manual', 'daily', 'weekly'] as const;
export type WebsiteScanFrequency = (typeof WEBSITE_SCAN_FREQUENCIES)[number];
