import { SELF_SERVE_PLAN_ORDER } from '@timeline/shared/billing/catalog';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SignupPlanSummary } from '@/components/signup-plan-summary';
import { signupPlanCopy } from '@/lib/signup-plan';

describe('SignupPlanSummary', () => {
  it.each([...SELF_SERVE_PLAN_ORDER])('renders the %s plan summary from catalog copy', (planId) => {
    const copy = signupPlanCopy(planId);
    const html = renderToStaticMarkup(createElement(SignupPlanSummary, { copy }));

    expect(html).toContain(`data-signup-plan="${planId}"`);
    expect(html).toContain(copy.name);
    expect(html).toContain('When billing starts:');
    expect(html).toContain('Review or change:');
    for (const item of copy.includes) {
      expect(html).toContain(item);
    }
    expect(html).toContain(copy.billingStarts);
    expect(html).toContain(copy.reviewWhere);
    expect(html.toLowerCase()).not.toContain('crm');
  });
});
