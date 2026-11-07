import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  listMarketingScreenshotReferences,
  listMissingMarketingScreenshots,
  marketingScreenshotFileExists,
} from '@/components/marketing/screenshot-inventory';

describe('marketing screenshot inventory', () => {
  it('requires every public marketing screenshot reference to exist on disk', () => {
    const refs = listMarketingScreenshotReferences();
    const files = refs.map((ref) => ref.file);

    expect(refs.length).toBeGreaterThan(20);
    expect(files).toContain('44-work-dark.png');
    expect(files).toContain('19-agent-tools-dark.png');
    expect(files).toContain('11-timeline-dark.png');
    expect(files).toContain('32-ask-handoff-dark.png');
    expect(marketingScreenshotFileExists('missing-marketing-shot.png')).toBe(false);
    expect(listMissingMarketingScreenshots(refs)).toEqual([]);
  });

  it('labels Ask captures as stored fictional examples without install noise', () => {
    const askCopy = listMarketingScreenshotReferences()
      .filter((ref) => ref.file.includes('ask'))
      .map((ref) => `${ref.alt} ${ref.caption}`)
      .join('\n');

    expect(askCopy).toMatch(/stored example/i);
    expect(askCopy).toMatch(/fictional Acme Labs demo/i);
    expect(askCopy).not.toMatch(/not live generated proof/i);
    expect(askCopy).not.toMatch(/\btli_|\btla_|POST \/api/u);
  });
});
