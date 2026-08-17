import { describe, expect, it } from 'vitest';

import {
  attachUniqueHubsToBundles,
  CONTAINER_LABEL_METADATA_KEYS,
  hubEvidenceText,
  hubMentionedInText,
  hubsChanged,
  mentionKeysForHub,
  qualifyWorkspaceHubs,
  selectPromptObjects,
  type WorkspaceHub,
} from '#src/suggestions/hub-context.js';

const fabaCompany: WorkspaceHub = {
  id: 'company-faba',
  type: 'company',
  name: 'Faba',
  aliases: ['Faba OÜ'],
  status: 'active',
};

const fabaProject: WorkspaceHub = {
  id: 'project-faba',
  type: 'project',
  name: 'Faba website redesign',
  aliases: [],
  status: 'active',
};

const acmeCompany: WorkspaceHub = {
  id: 'company-acme',
  type: 'company',
  name: 'Acme Labs',
  aliases: ['Acme'],
  status: 'active',
};

const acmeProject: WorkspaceHub = {
  id: 'project-acme',
  type: 'project',
  name: 'Acme project',
  aliases: ['Acme'],
  status: 'active',
};

const otherProject: WorkspaceHub = {
  id: 'project-other',
  type: 'project',
  name: 'Internal tooling',
  aliases: [],
  status: 'active',
};

describe('container label metadata keys', () => {
  it('keeps the envelope keys the qualify step reads', () => {
    expect(CONTAINER_LABEL_METADATA_KEYS).toEqual([
      'slack_channel_name',
      'tg_chat_title',
      'monday_board_name',
      'monday_item_board_name',
      'monday_workspace_name',
      'github_repo',
    ]);
  });
});

describe('mentionKeysForHub', () => {
  it('keeps distinctive client tokens and drops generic project words', () => {
    expect(mentionKeysForHub(fabaProject)).toEqual(
      expect.arrayContaining(['Faba website redesign', 'Faba']),
    );
    expect(mentionKeysForHub(fabaProject).map((key) => key.toLowerCase())).not.toContain('website');
    expect(mentionKeysForHub(fabaProject).map((key) => key.toLowerCase())).not.toContain(
      'redesign',
    );
  });
});

describe('hubMentionedInText', () => {
  it('matches a short client name inside a meeting title', () => {
    expect(hubMentionedInText(fabaCompany, 'Faba weekly: ship the login page')).toBe(true);
    expect(hubMentionedInText(fabaProject, 'Faba weekly: ship the login page')).toBe(true);
    expect(hubMentionedInText(acmeCompany, 'Faba weekly: ship the login page')).toBe(false);
  });
});

describe('qualifyWorkspaceHubs', () => {
  it('returns unique company and project when one client is named', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [fabaCompany, fabaProject, acmeCompany, otherProject],
      text: 'In the Faba meeting we should prepare the login page.',
    });
    expect(qualified.uniqueCompany).toEqual(fabaCompany);
    expect(qualified.uniqueProject).toEqual(fabaProject);
    expect(qualified.mentioned.map((hub) => hub.id).sort()).toEqual([
      'company-faba',
      'project-faba',
    ]);
  });

  it('does not attach a client when two companies are named', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [fabaCompany, acmeCompany, fabaProject],
      text: 'After the Faba call, also ping Acme about the login page.',
    });
    expect(qualified.uniqueCompany).toBeNull();
    expect(qualified.uniqueProject).toEqual(fabaProject);
  });

  it('does not treat generic website language as a project mention', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [fabaProject, otherProject],
      text: 'We should update the website copy this week.',
    });
    expect(qualified.mentioned).toEqual([]);
    expect(qualified.uniqueProject).toBeNull();
  });
});

describe('hubEvidenceText', () => {
  it('includes meeting titles from metadata so the transcript need not repeat the client', () => {
    const text = hubEvidenceText({
      text: 'We should prepare the login page.',
      sourceMetadata: { meeting_title: 'Faba weekly' },
    });
    expect(text).toContain('We should prepare the login page.');
    expect(text).toContain('Faba weekly');
  });

  it('includes Slack channel, Monday board, and Telegram chat container labels', () => {
    const text = hubEvidenceText({
      text: 'ok lets just do the login thing tomorrow',
      sourceMetadata: { slack_channel_name: 'acme-project-development' },
      window: [
        {
          contentText: 'Status: Working on login',
          sourceMetadata: { monday_board_name: 'Faba-ext' },
        },
      ],
      linkedContext: [
        {
          contentText: 'Voice note from the client chat',
          sourceMetadata: { tg_chat_title: 'Faba client' },
        },
      ],
    });
    expect(text).toContain('acme-project-development');
    expect(text).toContain('Faba-ext');
    expect(text).toContain('Faba client');
  });

  it('reads nested GitHub repo and Linear team names without a provider switch in callers', () => {
    const text = hubEvidenceText({
      text: 'merged the login fix',
      sourceMetadata: {
        github: { type: 'pull_request', repo: 'acme/app', number: 88 },
        linear: { team: { name: 'Faba delivery', key: 'FAB' }, project: { name: 'Faba website' } },
      },
    });
    expect(text).toContain('acme/app');
    expect(text).toContain('Faba delivery');
    expect(text).toContain('Faba website');
  });
});

describe('qualifyWorkspaceHubs from container labels', () => {
  it('qualifies Acme from a Slack channel named acme-project-development', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [acmeProject, fabaProject, fabaCompany],
      text: hubEvidenceText({
        text: 'yeah we should just ship the login, I can take it',
        sourceMetadata: { slack_channel_name: 'acme-project-development' },
      }),
    });
    expect(qualified.uniqueProject).toEqual(acmeProject);
    expect(qualified.mentioned.map((hub) => hub.id)).toEqual(['project-acme']);
  });

  it('qualifies Faba from a Monday board named Faba-ext', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [fabaCompany, fabaProject, acmeCompany, otherProject],
      text: hubEvidenceText({
        text: 'move login to done after QA',
        sourceMetadata: { monday_board_name: 'Faba-ext', monday_item_board_name: 'Faba-ext' },
      }),
    });
    expect(qualified.uniqueCompany).toEqual(fabaCompany);
    expect(qualified.uniqueProject).toEqual(fabaProject);
  });

  it('does not treat a generic #general channel as a unique hub', () => {
    const generalProject: WorkspaceHub = {
      id: 'project-general',
      type: 'project',
      name: 'General website redesign',
      aliases: [],
      status: 'active',
    };
    const qualified = qualifyWorkspaceHubs({
      hubs: [generalProject, fabaProject],
      text: hubEvidenceText({
        text: 'we should update the website copy this week',
        sourceMetadata: { slack_channel_name: 'general' },
      }),
    });
    expect(qualified.mentioned).toEqual([]);
    expect(qualified.uniqueProject).toBeNull();
  });

  it('refuses when a mixed channel name hits two companies and two projects', () => {
    const qualified = qualifyWorkspaceHubs({
      hubs: [fabaCompany, acmeCompany, fabaProject, acmeProject],
      text: hubEvidenceText({
        text: 'can someone take the login page',
        sourceMetadata: { slack_channel_name: 'acme-faba-shared' },
      }),
    });
    expect(qualified.uniqueCompany).toBeNull();
    expect(qualified.uniqueProject).toBeNull();
    expect(qualified.mentioned.map((hub) => hub.id).sort()).toEqual([
      'company-acme',
      'company-faba',
      'project-acme',
      'project-faba',
    ]);
  });
});

describe('selectPromptObjects', () => {
  it('keeps mentioned hubs ahead of recency-only objects', () => {
    const mentioned = [{ id: 'company-faba' }];
    const recent = Array.from({ length: 40 }, (_, index) => ({ id: `noise-${String(index)}` }));
    const selected = selectPromptObjects({ mentioned, recent, limit: 40 });
    expect(selected[0]).toEqual({ id: 'company-faba' });
    expect(selected).toHaveLength(40);
    expect(selected.some((row) => row.id === 'noise-39')).toBe(false);
  });
});

describe('attachUniqueHubsToBundles', () => {
  it('fills a bare task create with the unique project and company relation', () => {
    const [bundle] = attachUniqueHubsToBundles({
      bundles: [
        {
          items: [
            {
              operation: 'create',
              targetKind: 'task',
              title: 'Prepare the login page',
              proposedPayload: { canonicalName: 'Prepare the login page' },
            },
          ],
        },
      ],
      qualified: {
        mentioned: [fabaCompany, fabaProject],
        uniqueProject: fabaProject,
        uniqueCompany: fabaCompany,
      },
    });
    expect(bundle?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Prepare the login page',
      parentObjectId: 'project-faba',
      projectName: 'Faba website redesign',
      localRef: 'prepare-the-login-page',
    });
    expect(bundle?.items[1]).toMatchObject({
      targetKind: 'object_relationship',
      proposedPayload: {
        kind: 'related',
        fromRef: 'prepare-the-login-page',
        toEntityId: 'company-faba',
      },
    });
  });

  it('overwrites a model-proposed project with the unique qualified hub', () => {
    const existing = [
      {
        operation: 'create',
        targetKind: 'task',
        title: 'Prepare the login page',
        proposedPayload: {
          canonicalName: 'Prepare the login page',
          parentObjectId: 'project-other',
          localRef: 'login',
        },
      },
      {
        operation: 'create',
        targetKind: 'object_relationship',
        title: 'Relate login to Faba',
        proposedPayload: { kind: 'related', fromRef: 'login', toEntityId: 'company-faba' },
      },
    ];
    const [bundle] = attachUniqueHubsToBundles({
      bundles: [{ items: existing }],
      qualified: {
        mentioned: [fabaCompany, fabaProject],
        uniqueProject: fabaProject,
        uniqueCompany: fabaCompany,
      },
    });
    expect(bundle?.items).toHaveLength(2);
    expect(bundle?.items[0]?.proposedPayload.parentObjectId).toBe('project-faba');
    expect(bundle?.items[0]?.proposedPayload.projectName).toBe('Faba website redesign');
  });

  it('strips a model-proposed project when qualify is silent', () => {
    const [bundle] = attachUniqueHubsToBundles({
      bundles: [
        {
          items: [
            {
              operation: 'create',
              targetKind: 'task',
              title: 'Update the website copy',
              proposedPayload: {
                canonicalName: 'Update the website copy',
                parentObjectId: 'project-faba',
                projectName: 'Faba website redesign',
              },
            },
          ],
        },
      ],
      qualified: { mentioned: [], uniqueProject: null, uniqueCompany: null },
    });
    expect(bundle?.items[0]?.proposedPayload.parentObjectId).toBeUndefined();
    expect(bundle?.items[0]?.proposedPayload.projectName).toBeUndefined();
  });

  it('reports when attached hubs changed the pending items', () => {
    const before = [
      {
        operation: 'create',
        targetKind: 'task',
        title: 'Prepare the login page',
        proposedPayload: { canonicalName: 'Prepare the login page' },
      },
    ];
    const [after] = attachUniqueHubsToBundles({
      bundles: [{ items: before }],
      qualified: {
        mentioned: [fabaCompany],
        uniqueProject: null,
        uniqueCompany: fabaCompany,
      },
    });
    expect(hubsChanged(before, after?.items ?? [])).toBe(true);
    expect(hubsChanged(before, before)).toBe(false);
  });
});
