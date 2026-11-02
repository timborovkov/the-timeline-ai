import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CookiesError from '@/app/cookies/error';
import PrivacyError from '@/app/privacy/error';
import TrustError from '@/app/trust/error';
import {
  COOKIES_REVIEW_DATE,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TRUST_REVIEW_DATE,
} from '@/lib/legal-versions';

describe('legal route dates', () => {
  it('uses the same canonical dates in error states', () => {
    const errorProps = { error: new Error('Test failure'), reset: () => undefined };
    const states = [
      {
        error: <PrivacyError {...errorProps} />,
        date: `Version ${PRIVACY_VERSION} · Effective ${PRIVACY_EFFECTIVE_DATE}`,
      },
      {
        error: <CookiesError {...errorProps} />,
        date: `Notice · Last reviewed ${COOKIES_REVIEW_DATE}`,
      },
    ];
    for (const state of states) {
      expect(renderToStaticMarkup(state.error)).toContain(state.date);
    }
  });

  it('keeps the trust error on the reviewed legal date', () => {
    const errorHtml = renderToStaticMarkup(
      <TrustError error={new Error('Test failure')} reset={() => undefined} />,
    );

    expect(errorHtml).toContain(`Trust · Last reviewed ${TRUST_REVIEW_DATE}`);
    expect(errorHtml).not.toContain('href="/sign-in"');
    expect(errorHtml).not.toContain('href="/sign-up"');
    expect(errorHtml).not.toContain('>Start free</a>');
  });
});
