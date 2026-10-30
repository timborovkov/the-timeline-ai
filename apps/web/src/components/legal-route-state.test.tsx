import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CookiesError from '@/app/cookies/error';
import CookiesLoading from '@/app/cookies/loading';
import PrivacyError from '@/app/privacy/error';
import PrivacyLoading from '@/app/privacy/loading';
import TrustError from '@/app/trust/error';
import TrustLoading from '@/app/trust/loading';
import {
  COOKIES_REVIEW_DATE,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TRUST_REVIEW_DATE,
} from '@/lib/legal-versions';

describe('legal route dates', () => {
  it('uses the same canonical dates in loading and error states', () => {
    const errorProps = { error: new Error('Test failure'), reset: () => undefined };
    const states = [
      {
        loading: <PrivacyLoading />,
        error: <PrivacyError {...errorProps} />,
        date: `Version ${PRIVACY_VERSION} · Effective ${PRIVACY_EFFECTIVE_DATE}`,
      },
      {
        loading: <CookiesLoading />,
        error: <CookiesError {...errorProps} />,
        date: `Notice · Last reviewed ${COOKIES_REVIEW_DATE}`,
      },
      {
        loading: <TrustLoading />,
        error: <TrustError {...errorProps} />,
        date: `Trust · Last reviewed ${TRUST_REVIEW_DATE}`,
      },
    ];
    for (const state of states) {
      expect(renderToStaticMarkup(state.loading)).toContain(state.date);
      expect(renderToStaticMarkup(state.error)).toContain(state.date);
    }
  });
});
