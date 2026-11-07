import type { Db } from '@timeline/db';
import { SlackApi } from '#src/slack/api.js';
import { findWorkspaceInstallForTeam, decryptWorkspaceToken } from '#src/slack/workspace-access.js';

export async function sendTeamSlackMessage(input: {
  db: Db;
  teamId: string;
  channelId: string;
  text: string;
}): Promise<void> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) throw new Error('Slack workspace is no longer enabled for this team');
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken, install.slackTeamId);
  await api.postMessage({ channel: input.channelId, text: input.text });
}

export async function sendTeamSlackDirectMessage(input: {
  db: Db;
  teamId: string;
  slackUserId: string;
  text: string;
}): Promise<void> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) throw new Error('Slack workspace is no longer enabled for this team');
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken, install.slackTeamId);
  try {
    await api.postMessage({ channel: input.slackUserId, text: input.text });
  } catch {
    const opened = await api.conversationsOpen(input.slackUserId);
    await api.postMessage({ channel: opened.id, text: input.text });
  }
}
