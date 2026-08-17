import { type Db, teamDigestDestinations } from '@timeline/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

const DIGEST_DESTINATION_KINDS = [
  'email_members',
  'slack_channel',
  'slack_dm_members',
  'telegram_chat',
  'telegram_dm_members',
] as const;

export type DigestDestinationKind = (typeof DIGEST_DESTINATION_KINDS)[number];

const PERSONAL_DIGEST_DESTINATION_KINDS = [
  'email_members',
  'slack_dm_members',
  'telegram_dm_members',
] as const satisfies readonly DigestDestinationKind[];

const SHARED_DIGEST_DESTINATION_KINDS = [
  'slack_channel',
  'telegram_chat',
] as const satisfies readonly DigestDestinationKind[];

const PERSONAL_KIND_SET = new Set<string>(PERSONAL_DIGEST_DESTINATION_KINDS);
const SHARED_KIND_SET = new Set<string>(SHARED_DIGEST_DESTINATION_KINDS);

export interface TeamDigestDestination {
  id: string;
  teamId: string;
  kind: DigestDestinationKind;
  targetId: string | null;
  label: string | null;
  enabled: boolean;
}

export function isPersonalDigestDestination(kind: string): boolean {
  return PERSONAL_KIND_SET.has(kind);
}

export function isSharedDigestDestination(kind: string): boolean {
  return SHARED_KIND_SET.has(kind);
}

function digestDestinationRequiresTarget(kind: DigestDestinationKind): boolean {
  return isSharedDigestDestination(kind);
}

const addDestinationSchema = z
  .object({
    kind: z.enum(DIGEST_DESTINATION_KINDS),
    targetId: z.string().trim().min(1).max(128).optional(),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (digestDestinationRequiresTarget(value.kind) && !value.targetId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose where the digest should be posted.',
        path: ['targetId'],
      });
    }
    if (!digestDestinationRequiresTarget(value.kind) && value.targetId) {
      ctx.addIssue({
        code: 'custom',
        message: 'This destination does not take a specific chat.',
        path: ['targetId'],
      });
    }
  });

export type AddDigestDestinationInput = z.infer<typeof addDestinationSchema>;

export function parseAddDigestDestinationInput(
  input: unknown,
): { ok: true; value: AddDigestDestinationInput } | { ok: false; error: string } {
  const parsed = addDestinationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid digest destination' };
  }
  return { ok: true, value: parsed.data };
}

export function personalDigestDestinations(
  destinations: TeamDigestDestination[],
): TeamDigestDestination[] {
  return destinations.filter((destination) => isPersonalDigestDestination(destination.kind));
}

export function sharedDigestDestinations(
  destinations: TeamDigestDestination[],
): TeamDigestDestination[] {
  return destinations.filter((destination) => isSharedDigestDestination(destination.kind));
}

export function digestDestinationLabel(destination: TeamDigestDestination): string {
  if (destination.kind === 'email_members') return 'Email every member';
  if (destination.kind === 'slack_dm_members') return 'Slack DM every linked member';
  if (destination.kind === 'telegram_dm_members') return 'Telegram DM every linked member';
  if (destination.kind === 'slack_channel') {
    return destination.label ? `Slack ${destination.label}` : 'Slack channel';
  }
  return destination.label ? `Telegram · ${destination.label}` : 'Telegram chat';
}

export function digestDestinationDedupeKey(input: {
  scope: 'member' | 'workspace';
  digestId?: string;
  teamId: string;
  windowEnd: string;
  destination: Pick<TeamDigestDestination, 'kind' | 'targetId'>;
}): string {
  if (input.scope === 'member') {
    if (input.destination.kind === 'email_members') {
      return `daily_digest:${input.digestId}`;
    }
    return `daily_digest:${input.digestId}:${input.destination.kind}`;
  }
  const target = input.destination.targetId ?? 'none';
  return `daily_digest:workspace:${input.teamId}:${input.windowEnd}:${input.destination.kind}:${target}`;
}

export async function listTeamDigestDestinations(
  db: Db,
  teamId: string,
): Promise<TeamDigestDestination[]> {
  return db
    .select({
      id: teamDigestDestinations.id,
      teamId: teamDigestDestinations.teamId,
      kind: teamDigestDestinations.kind,
      targetId: teamDigestDestinations.targetId,
      label: teamDigestDestinations.label,
      enabled: teamDigestDestinations.enabled,
    })
    .from(teamDigestDestinations)
    .where(and(eq(teamDigestDestinations.teamId, teamId), eq(teamDigestDestinations.enabled, true)))
    .orderBy(desc(teamDigestDestinations.createdAt))
    .limit(50);
}

export async function listWorkspaceDigestTeamIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ teamId: teamDigestDestinations.teamId })
    .from(teamDigestDestinations)
    .where(
      and(
        eq(teamDigestDestinations.enabled, true),
        inArray(teamDigestDestinations.kind, [...SHARED_DIGEST_DESTINATION_KINDS]),
      ),
    );
  return rows.map((row) => row.teamId);
}

export async function insertDefaultDigestDestination(
  db: Pick<Db, 'insert'>,
  teamId: string,
): Promise<void> {
  await db
    .insert(teamDigestDestinations)
    .values({
      teamId,
      kind: 'email_members',
      enabled: true,
    })
    .onConflictDoNothing();
}

export async function addTeamDigestDestination(input: {
  db: Db;
  teamId: string;
  createdByUserId: string;
  destination: AddDigestDestinationInput;
}): Promise<{ id: string } | { error: string }> {
  const targetId = digestDestinationRequiresTarget(input.destination.kind)
    ? (input.destination.targetId ?? null)
    : null;
  const label = input.destination.label ?? null;
  try {
    const [row] = await input.db
      .insert(teamDigestDestinations)
      .values({
        teamId: input.teamId,
        kind: input.destination.kind,
        targetId,
        label,
        enabled: true,
        createdByUserId: input.createdByUserId,
      })
      .onConflictDoNothing()
      .returning({ id: teamDigestDestinations.id });
    if (!row?.id) return { error: 'That digest destination is already configured.' };
    return { id: row.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/team_digest_destinations_target_chk|check constraint/i.test(message)) {
      return { error: 'That digest destination is not valid.' };
    }
    throw err;
  }
}

export async function removeTeamDigestDestination(input: {
  db: Db;
  teamId: string;
  destinationId: string;
}): Promise<boolean> {
  const rows = await input.db
    .delete(teamDigestDestinations)
    .where(
      and(
        eq(teamDigestDestinations.id, input.destinationId),
        eq(teamDigestDestinations.teamId, input.teamId),
      ),
    )
    .returning({ id: teamDigestDestinations.id });
  return rows.length > 0;
}
