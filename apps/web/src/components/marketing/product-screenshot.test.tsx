import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';

const BASE = {
  alt: 'Ask recap with numbered citations.',
  caption: 'Ask for a status or a handoff brief, and every line cites where it came from.',
};

describe('MarketingProductScreenshot', () => {
  it('keeps landscape product shots in a 16×10 top crop', () => {
    const html = renderToStaticMarkup(
      <MarketingProductScreenshot {...BASE} file="32-ask-handoff-dark.png" />,
    );

    expect(html).toContain('data-screenshot-file="32-ask-handoff-dark.png"');
    expect(html).toContain('data-screenshot-frame="landscape"');
    expect(html).toContain('aspect-[16/10]');
    expect(html).toContain('object-cover');
    expect(html).toContain('object-top');
    expect(html).toContain('/marketing/screenshots/32-ask-handoff-dark.png');
    expect(html).not.toContain('/_next/image');
    expect(html).not.toContain('aspect-[390/844]');
    expect(html).not.toContain('object-contain');
  });

  it('labels a missing file instead of inventing UI', () => {
    const html = renderToStaticMarkup(
      <MarketingProductScreenshot {...BASE} file="missing-marketing-shot.png" />,
    );

    expect(html).toContain('data-screenshot-present="false"');
    expect(html).toContain('Screenshot placeholder');
    expect(html).toContain('missing-marketing-shot.png');
  });

  it('fits portrait mobile shots without cropping the capture', () => {
    const html = renderToStaticMarkup(
      <MarketingProductScreenshot {...BASE} file="54-ask-recap-mobile.png" frame="portrait" />,
    );

    expect(html).toContain('data-screenshot-file="54-ask-recap-mobile.png"');
    expect(html).toContain('data-screenshot-frame="portrait"');
    expect(html).toContain('aspect-[390/844]');
    expect(html).toContain('object-contain');
    expect(html).toContain('object-top');
    expect(html).not.toContain('aspect-[16/10]');
    expect(html).not.toContain('object-cover');
  });

  it('reserves the frame and shows a loading label behind the image', () => {
    const html = renderToStaticMarkup(
      <MarketingProductScreenshot {...BASE} file="32-ask-handoff-dark.png" />,
    );

    expect(html).toContain('data-screenshot-pending');
    expect(html).toContain('Loading screenshot');
    expect(html).toContain('aspect-[16/10]');
    expect(html).not.toContain('data-screenshot-callouts');
  });

  it('renders always-visible callouts without hover-only copy', () => {
    const html = renderToStaticMarkup(
      <MarketingProductScreenshot
        {...BASE}
        file="32-ask-handoff-dark.png"
        callouts={[
          { label: 'What changed', detail: 'Current state and the open gap.' },
          { label: 'Who owns the next step', detail: 'Owner in flight is named.' },
          { label: 'Link to the source', detail: 'Numbered citations open the evidence.' },
        ]}
      />,
    );

    expect(html).toContain('data-screenshot-callouts');
    expect(html).toContain('What changed');
    expect(html).toContain('Who owns the next step');
    expect(html).toContain('Link to the source');
    expect(html).toContain('Numbered citations open the evidence.');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('group-hover');
  });
});
