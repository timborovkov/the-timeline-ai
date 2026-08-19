// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/slack', () => ({
  bindSlackConversationAction: vi.fn(),
  unbindSlackConversationAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/env', () => ({ getEnv: vi.fn(() => ({})) }));
vi.mock('@timeline/shared/team-scope', () => ({ withTeam: vi.fn() }));
vi.mock('@timeline/shared/slack', () => ({ listSlackConversationsForTeam: vi.fn() }));

const { SlackSettingsPageView } = await import('@/app/app/team/slack/slack-settings-page-content');

afterEach(() => {
  cleanup();
});

function model(
  overrides: Partial<Parameters<typeof SlackSettingsPageView>[0]['model']> = {},
): Parameters<typeof SlackSettingsPageView>[0]['model'] {
  return {
    configured: true,
    isAdmin: true,
    teamName: 'Acme Labs',
    install: {
      name: 'Acme Slack',
      slackTeamId: 'T123',
      enabled: true,
    },
    bindings: [
      {
        id: 'binding-1',
        slackConversationId: 'C123',
        title: '#launch',
        conversationType: 'channel',
        visibilityDefault: 'team',
      },
    ],
    linkedSlackUsers: [
      {
        id: 'slack-user-1',
        slackUserId: 'U123',
        name: 'ada',
        realName: 'Ada Lovelace',
        email: 'ada@slack.test',
        isActive: true,
        appUser: {
          name: 'Ada',
          email: 'ada@example.test',
        },
      },
    ],
    unboundConversations: [
      { id: 'C999', name: 'support', is_member: false },
      { id: 'C555', name: 'sales', is_member: true },
    ],
    ...overrides,
  };
}

describe('SlackSettingsPageView', () => {
  it('renders missing configuration and install guidance for admins', () => {
    render(
      <SlackSettingsPageView
        model={model({
          configured: false,
          install: null,
          bindings: [],
          linkedSlackUsers: [],
          unboundConversations: [],
        })}
      />,
    );

    expect(screen.getByText(/SLACK_CLIENT_ID/)).toBeTruthy();
    expect(screen.getByText(/Install the Slack app before binding channels/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Install Slack' }).getAttribute('href')).toBe(
      '/api/slack/install/start',
    );
    expect(screen.getByRole('link', { name: 'Connect identity' }).getAttribute('href')).toBe(
      '/api/slack/user-link/start',
    );
    expect(screen.getByText('No Slack conversations bound yet')).toBeTruthy();
    expect(screen.getByText('No Slack identities linked yet')).toBeTruthy();
  });

  it('renders installed workspace, unbound conversation choices, bindings, and linked users', () => {
    render(<SlackSettingsPageView model={model()} />);

    expect(screen.getByText('Acme Slack')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.queryByText(/workspace T123/)).toBeNull();
    expect(screen.getByText('Slack workspace ID').closest('details')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect' }).getAttribute('href')).toBe(
      '/api/slack/install/start',
    );
    expect(screen.getByRole('option', { name: '#support (invite bot first)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '#sales' })).toBeTruthy();
    expect(screen.getByLabelText('Conversation to bind')).toHaveProperty('required', true);
    expect(screen.queryByRole('option', { name: '#launch' })).toBeNull();
    expect(screen.getByText('#launch')).toBeTruthy();
    expect(screen.getAllByText('Channel · Team visibility')).toHaveLength(2);
    expect(screen.getByText('Slack conversation ID').closest('details')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unbind' })).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getAllByText(/Slack Ada Lovelace · ada@slack\.test/)).toHaveLength(2);
    expect(screen.getByText('Active DM')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Slack', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('stacks long binding and identity rows before the small-screen layout runs out of room', () => {
    render(
      <SlackSettingsPageView
        model={model({
          bindings: [
            {
              id: 'binding-long',
              slackConversationId: 'C456',
              title: '#a-very-long-conversation-name-that-needs-room-to-wrap',
              conversationType: 'private_channel',
              visibilityDefault: 'specific_users',
            },
          ],
          linkedSlackUsers: [
            {
              id: 'slack-user-long',
              slackUserId: 'U456',
              name: 'very-long-slack-handle',
              realName: 'A very long Slack member name',
              email: 'a-very-long-slack-identity-address@example.test',
              isActive: true,
              appUser: { name: 'A very long Timeline member name', email: null },
            },
          ],
        })}
      />,
    );

    const bindingTitle = screen.getByText('#a-very-long-conversation-name-that-needs-room-to-wrap');
    const bindingRow = bindingTitle.closest('[class*="group/collection-row"]');
    expect(bindingRow?.className).toContain('min-h-11');
    expect(bindingRow?.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
    expect(bindingTitle.className).toContain('truncate');
    expect(bindingRow?.querySelector('.sm\\:flex-row')).toBeTruthy();
    expect(screen.getAllByText('Private channel · Selected people')).toHaveLength(2);

    const identityContexts = screen.getAllByText(
      'Slack A very long Slack member name · a-very-long-slack-identity-address@example.test',
    );
    expect(identityContexts).toHaveLength(2);
    const identityRow = identityContexts[0]?.closest('[class*="group/collection-row"]');
    expect(identityRow?.className).toContain('min-h-11');
    expect(identityRow?.querySelector('.sm\\:flex-row')).toBeTruthy();
    expect(screen.getByText('A very long Timeline member name').className).toContain('truncate');
    expect(screen.getByText('Active DM').className).toContain('truncate');
  });

  it('keeps member-facing settings read-only while preserving status context', () => {
    render(<SlackSettingsPageView model={model({ isAdmin: false, unboundConversations: [] })} />);

    expect(screen.getByText('Acme Slack')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Reconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bind' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unbind' })).toBeNull();
    expect(screen.getByText('#launch')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });
});
