import { type Db, slackWorkspaces, slackWorkspaceTeams } from '@timeline/db';
import { and, eq } from 'drizzle-orm';
import { decryptJson, type EncryptedSecret } from '#src/crypto/secrets.js';

export interface SlackTokenJson {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  authedUserAccessToken?: string;
  authedUserScope?: string;
}

export interface SlackWorkspaceRecord {
  id: string;
  slackTeamId: string;
  appId?: string | null;
  botUserId: string | null;
  tokenCiphertext: Buffer;
  tokenIv: Buffer;
  tokenTag: Buffer;
}

export async function findWorkspaceBySlackTeamId(
  db: Db,
  slackTeamId: string | undefined,
): Promise<SlackWorkspaceRecord | null> {
  if (!slackTeamId) return null;
  const rows = await db
    .select({
      id: slackWorkspaces.id,
      slackTeamId: slackWorkspaces.slackTeamId,
      appId: slackWorkspaces.appId,
      botUserId: slackWorkspaces.botUserId,
      tokenCiphertext: slackWorkspaces.tokenCiphertext,
      tokenIv: slackWorkspaces.tokenIv,
      tokenTag: slackWorkspaces.tokenTag,
    })
    .from(slackWorkspaces)
    .where(eq(slackWorkspaces.slackTeamId, slackTeamId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findWorkspaceInstallForTeam(
  db: Db,
  teamId: string,
): Promise<SlackWorkspaceRecord | null> {
  const rows = await db
    .select({
      id: slackWorkspaces.id,
      slackTeamId: slackWorkspaces.slackTeamId,
      appId: slackWorkspaces.appId,
      botUserId: slackWorkspaces.botUserId,
      tokenCiphertext: slackWorkspaces.tokenCiphertext,
      tokenIv: slackWorkspaces.tokenIv,
      tokenTag: slackWorkspaces.tokenTag,
    })
    .from(slackWorkspaceTeams)
    .innerJoin(slackWorkspaces, eq(slackWorkspaces.id, slackWorkspaceTeams.workspaceId))
    .where(and(eq(slackWorkspaceTeams.teamId, teamId), eq(slackWorkspaceTeams.enabled, true)))
    .limit(1);
  return rows[0] ?? null;
}

export function decryptWorkspaceToken(workspace: SlackWorkspaceRecord): SlackTokenJson {
  return decryptJson({
    ciphertext: workspace.tokenCiphertext,
    iv: workspace.tokenIv,
    tag: workspace.tokenTag,
  } satisfies EncryptedSecret) as SlackTokenJson;
}
