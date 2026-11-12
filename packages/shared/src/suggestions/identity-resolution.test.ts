import { describe, expect, it } from 'bun:test';

import {
  resolveObjectIdentity,
  resolveCompanyAffiliation,
} from '#src/suggestions/identity-resolution.js';

// Identity must preserve distinct initiatives and people, including translated names.
const project = (id: string, name: string, metadata = {}, aliases: string[] = []) => ({
  id,
  type: 'project',
  canonicalName: name,
  aliases,
  metadata,
});
describe('shared identity resolution', () => {
  it('does not collapse sibling portals or first-name-only people', () => {
    expect(
      resolveObjectIdentity(project('new', 'Client Portal'), [project('a', 'Partner Portal')]).kind,
    ).toBe('new');
    expect(
      resolveObjectIdentity({ id: 'n', type: 'person', canonicalName: 'Alex Smith' }, [
        { id: 'a', type: 'person', canonicalName: 'Alex Jones' },
      ]).kind,
    ).toBe('new');
  });
  it('resolves approved multilingual aliases but preserves conflicting scope', () => {
    const existing = project('a', 'Client Portal', { companyId: 'company-a' }, ['PBC-portaali']);
    expect(
      resolveObjectIdentity(project('n', 'PBC-portaali', { companyId: 'company-a' }), [existing]),
    ).toMatchObject({ kind: 'existing', objectId: 'a' });
    expect(
      resolveObjectIdentity(project('n', 'PBC-portaali', { companyId: 'company-b' }), [existing])
        .kind,
    ).toBe('new');
  });
  it('reports ambiguity instead of picking an arbitrary duplicate', () => {
    expect(
      resolveObjectIdentity(project('n', 'Portal'), [
        project('a', 'Portal'),
        project('b', 'Portal'),
      ]).kind,
    ).toBe('ambiguous');
  });
  it('retains non-Latin distinctions and accents', () => {
    expect(
      resolveObjectIdentity(project('n', '客户门户'), [project('a', '合作伙伴门户')]).kind,
    ).toBe('new');
    expect(
      resolveObjectIdentity(project('n', 'Asiakasportaali'), [project('a', 'Asiakasportaali')])
        .kind,
    ).toBe('existing');
  });
  it('never treats separate provider records as identical by title', () => {
    expect(
      resolveObjectIdentity(
        project('n', 'Portal', {
          integration_provider: 'github',
          integration_external_id: 'repo-a#1',
        }),
        [
          project('a', 'Portal', {
            integration_provider: 'github',
            integration_external_id: 'repo-b#1',
          }),
        ],
      ).kind,
    ).toBe('new');
  });
});
describe('company domain affiliation', () => {
  const companies = [
    { id: 'a', type: 'company', canonicalName: 'Acme', metadata: { domain: 'acme.test' } },
  ];
  it('requires a unique evidenced domain and excludes public mail providers', () => {
    expect(resolveCompanyAffiliation(['alex@acme.test'], companies)).toEqual({
      kind: 'existing',
      objectId: 'a',
      reason: 'business_email_domain',
    });
    expect(
      resolveCompanyAffiliation(
        ['alex@gmail.com'],
        [{ ...required(companies[0]), metadata: { domain: 'gmail.com' } }],
      ).kind,
    ).toBe('new');
    expect(
      resolveCompanyAffiliation(
        ['alex@acme.test'],
        [...companies, { ...required(companies[0]), id: 'b' }],
      ).kind,
    ).toBe('ambiguous');
    expect(resolveCompanyAffiliation(['alex@notacme.test'], companies).kind).toBe('new');
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value');
  return value;
}
