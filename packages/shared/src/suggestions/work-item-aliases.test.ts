import { describe, expect, it } from 'vitest';

import {
  stampUniqueWorkItemAliasesOntoBundles,
  uniqueWorkItemAliasesFromText,
} from '#src/suggestions/work-item-aliases.js';

describe('uniqueWorkItemAliasesFromText', () => {
  it('stamps a unique GitHub repo#n and refuses two ids', () => {
    expect(uniqueWorkItemAliasesFromText('please take acme/app#88 after lunch')).toEqual([
      { alias: 'acme/app#88', kind: 'github' },
    ]);
    expect(
      uniqueWorkItemAliasesFromText('acme/app#88 and acme/app#91 are both in flight'),
    ).toBeNull();
    expect(uniqueWorkItemAliasesFromText('https://github.com/acme/app/pull/88 lgtm')).toEqual([
      { alias: 'acme/app#88', kind: 'github' },
    ]);
  });

  it('stamps a unique Linear key and ignores RFC/UTF lookalikes', () => {
    expect(uniqueWorkItemAliasesFromText('ENG-42 is the login bug')).toEqual([
      { alias: 'ENG-42', kind: 'linear' },
    ]);
    expect(uniqueWorkItemAliasesFromText('see RFC-5545 and UTF-8')).toBeNull();
  });

  it('stamps a unique Monday item id from a pulse URL', () => {
    expect(
      uniqueWorkItemAliasesFromText(
        'board https://acme.monday.com/boards/1/pulses/1771812728 looks done',
      ),
    ).toEqual([{ alias: '1771812728', kind: 'monday' }]);
  });

  it('refuses a GitHub id mixed with a Linear key', () => {
    expect(uniqueWorkItemAliasesFromText('acme/app#88 is ENG-42')).toBeNull();
  });
});

describe('stampUniqueWorkItemAliasesOntoBundles', () => {
  it('copies the unique id onto create-task aliases only', () => {
    const [bundle] = stampUniqueWorkItemAliasesOntoBundles({
      text: 'yeah grab acme/app#88 tomorrow',
      bundles: [
        {
          items: [
            {
              operation: 'create',
              targetKind: 'task',
              title: 'Fix login',
              proposedPayload: { canonicalName: 'Fix login' },
            },
            {
              operation: 'create',
              targetKind: 'object',
              title: 'Acme',
              proposedPayload: { type: 'company', canonicalName: 'Acme' },
            },
          ],
        },
      ],
    });
    const payload = (bundle?.items[0]?.proposedPayload ?? {}) as Record<string, unknown>;
    const aliases = payload.aliases;
    expect(Array.isArray(aliases)).toBe(true);
    if (!Array.isArray(aliases)) throw new Error('expected aliases');
    expect(aliases).toContain('acme/app#88');
    expect(aliases).toContain('PR-acme/app-88');
    expect(bundle?.items[1]?.proposedPayload).not.toHaveProperty('aliases');
  });
});
