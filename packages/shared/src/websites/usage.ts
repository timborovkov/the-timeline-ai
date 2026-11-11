/** Dependency-free customer usage contract shared by billing and the public calculator. */
export const WEBSITE_SOURCE_UNITS_PER_PAGE = 20;
export const WEBSITE_PAGE_LIMIT = 5;
export function websiteSourceUnits(
  pages: number,
  multiplier = WEBSITE_SOURCE_UNITS_PER_PAGE,
): number {
  if (!Number.isInteger(pages) || pages < 0 || !Number.isInteger(multiplier) || multiplier < 1)
    throw new Error('Invalid website usage');
  return pages * multiplier;
}
export function estimateWebsiteUsage(input: {
  websites: number;
  pages: number;
  frequency: 'manual' | 'daily' | 'weekly';
  manualScans: number;
}) {
  if (
    !Number.isInteger(input.websites) ||
    input.websites < 0 ||
    input.websites > 100 ||
    !Number.isInteger(input.pages) ||
    input.pages < 1 ||
    input.pages > WEBSITE_PAGE_LIMIT ||
    !Number.isInteger(input.manualScans) ||
    input.manualScans < 0 ||
    input.manualScans > 720
  )
    throw new Error('Invalid website estimate');
  const scansPerWebsite =
    input.frequency === 'daily' ? 30 : input.frequency === 'weekly' ? 5 : input.manualScans;
  const pages = input.websites * input.pages * scansPerWebsite;
  return { pages, scansPerWebsite, sourceUnits: websiteSourceUnits(pages) };
}
