import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import ProductTourRoutePage from '@/app/product-tour/page';
import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';

function figureHtml(html: string, file: string): string {
  const attr = `data-screenshot-file="${file}"`;
  const attrAt = html.indexOf(attr);
  expect(attrAt).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<figure', attrAt);
  const end = html.indexOf('</figure>', attrAt);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '</figure>'.length);
}

describe('product tour route', () => {
  it('renders every drafted step with a named screenshot slot', () => {
    const html = renderToStaticMarkup(<ProductTourRoutePage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(PRODUCT_TOUR.title);
    expect(html).toContain('data-product-tour');
    expect(html).toContain('Start free');
    expect(html).toContain('See pricing');
    expect(html).toContain('Lasting record changes wait for your approval.');
    expect(html).not.toContain('Nothing changes until you approve it.');
    expect(html).toContain('data-first-run="compact"');
    expect(PRODUCT_TOUR.steps).toHaveLength(8);

    for (const step of PRODUCT_TOUR.steps) {
      expect(html).toContain(`data-tour-step="${step.index}"`);
      expect(html).toContain(step.headline);
      expect(html).toContain(`data-screenshot-file="${step.file}"`);
      expect(html).toContain('data-screenshot-present="true"');
      expect(html).toContain(step.file);
      if (step.mobileFile) expect(html).toContain(step.mobileFile);
    }
    expect(html).not.toContain('Screenshot placeholder');
  });

  it('keeps mobile recap citations in a portrait frame instead of a 16×10 crop', () => {
    const html = renderToStaticMarkup(<ProductTourRoutePage />);
    const recap = figureHtml(html, '54-ask-recap-mobile.png');
    const handoff = figureHtml(html, '32-ask-handoff-dark.png');

    expect(recap).toContain('data-screenshot-frame="portrait"');
    expect(recap).toContain('aspect-[390/844]');
    expect(recap).toContain('Loading screenshot');
    expect(recap).not.toContain('<img');
    expect(recap).not.toContain('aspect-[16/10]');
    expect(recap).not.toContain('object-cover');

    expect(handoff).toContain('data-screenshot-frame="landscape"');
    expect(handoff).toContain('aspect-[16/10]');
    expect(handoff).toContain('Loading screenshot');
    expect(handoff).not.toContain('<img');
    expect(handoff).not.toContain('aspect-[390/844]');

    for (const step of PRODUCT_TOUR.steps) {
      if (!step.mobileFile) continue;
      const mobile = figureHtml(html, step.mobileFile);
      expect(mobile).toContain('data-screenshot-frame="portrait"');
      expect(mobile).toContain('aspect-[390/844]');
      const desktop = figureHtml(html, step.file);
      expect(desktop).toContain('data-screenshot-frame="landscape"');
      expect(desktop).toContain('aspect-[16/10]');
    }
  });
});
