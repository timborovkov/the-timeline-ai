import {
  boardItems,
  calendarEvents,
  chatSessions,
  documentVersions,
  documents,
  entities,
  getDb,
  meetings,
  notifications,
  rawEvents,
  userPins,
} from '@timeline/db';
import { eq } from 'drizzle-orm';

function heavyUuid(bucket: string, index: number): string {
  return `${bucket}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export interface HeavySeedIds {
  team: string;
  owner: string;
  member: string;
  board: string;
  laneTodo: string;
  laneDoing: string;
  laneDone: string;
}

type SeedTx = Pick<ReturnType<typeof getDb>, 'insert' | 'update'>;

export async function seedHeavyAcmeLabs(tx: SeedTx, ids: HeavySeedIds): Promise<void> {
  const now = new Date('2026-08-17T12:00:00.000Z');
  const taskStatuses = ['todo', 'doing', 'done', 'blocked'] as const;
  const lanes = [ids.laneTodo, ids.laneDoing, ids.laneDone];

  const events = Array.from({ length: 400 }, (_, index) => ({
    id: heavyUuid('aa110001', index + 1),
    teamId: ids.team,
    authorUserId: index % 2 === 0 ? ids.owner : ids.member,
    source: 'web' as const,
    contentText: `Heavy seed moment ${String(index + 1).padStart(3, '0')}: Atlas volume check.`,
    occurredAt: new Date(now.getTime() - (index + 1) * 3_600_000),
    visibility: 'team' as const,
    sourceMetadata: { seed: true, heavy: true, n: index + 1 },
  }));

  const tasks = Array.from({ length: 300 }, (_, index) => ({
    id: heavyUuid('aa120001', index + 1),
    teamId: ids.team,
    type: 'task' as const,
    canonicalName: `Heavy seed task ${String(index + 1).padStart(3, '0')}`,
    aliases: [],
    metadata: { seed: true, heavy: true },
    status: taskStatuses[index % taskStatuses.length] ?? 'todo',
    priority: (index % 4) + 1,
    ownerUserId: ids.owner,
    assigneeUserId: index % 3 === 0 ? ids.member : ids.owner,
  }));

  const objects = Array.from({ length: 200 }, (_, index) => ({
    id: heavyUuid('aa130001', index + 1),
    teamId: ids.team,
    type: 'topic' as const,
    canonicalName: `Heavy seed object ${String(index + 1).padStart(3, '0')}`,
    aliases: [],
    metadata: { seed: true, heavy: true },
    status: 'open',
    ownerUserId: ids.owner,
  }));

  const docs = Array.from({ length: 60 }, (_, index) => ({
    id: heavyUuid('aa140001', index + 1),
    teamId: ids.team,
    fileKind: 'document' as const,
    name: `Heavy seed brief ${String(index + 1).padStart(3, '0')}.md`,
    ownerUserId: ids.owner,
    visibility: 'team' as const,
    metadata: { seed: true, heavy: true },
  }));
  const captures = Array.from({ length: 60 }, (_, index) => ({
    id: heavyUuid('aa150001', index + 1),
    teamId: ids.team,
    fileKind: 'captured' as const,
    name: `heavy-capture-${String(index + 1).padStart(3, '0')}.txt`,
    ownerUserId: ids.owner,
    visibility: 'team' as const,
    metadata: { seed: true, heavy: true },
  }));
  const versions = [...docs, ...captures].map((doc, index) => ({
    id: heavyUuid('aa160001', index + 1),
    teamId: ids.team,
    documentId: doc.id,
    version: 1,
    objectKey: `dev-seed/heavy/${doc.id}/v1`,
    contentType: 'text/plain',
    byteSize: 32,
    uploadedByUserId: ids.owner,
    processingStatus: 'chunked' as const,
  }));

  const inbox = Array.from({ length: 80 }, (_, index) => ({
    id: heavyUuid('aa180001', index + 1),
    teamId: ids.team,
    userId: ids.owner,
    kind: 'object_changed' as const,
    entityId: objects[index % objects.length]?.id ?? null,
    summary: `Heavy seed notification ${String(index + 1).padStart(3, '0')}`,
    payload: { seed: true, heavy: true },
    createdAt: new Date(now.getTime() - index * 60_000),
  }));

  const pins = Array.from({ length: 60 }, (_, index) => ({
    id: heavyUuid('aa190001', index + 1),
    teamId: ids.team,
    userId: ids.owner,
    targetKind: 'object' as const,
    targetKey: (index < 30 ? tasks[index]?.id : objects[index - 30]?.id) ?? tasks[0]!.id,
    sortKey: BigInt(index + 1),
  }));

  const boardCards = tasks.slice(0, 150).map((task, index) => ({
    id: heavyUuid('aa1a0001', index + 1),
    teamId: ids.team,
    boardId: ids.board,
    entityId: task.id,
    laneId: lanes[index % lanes.length] ?? ids.laneTodo,
    position: index,
    responsibleUserId: ids.owner,
    priority: (index % 4) + 1,
  }));

  const meetingRows = Array.from({ length: 40 }, (_, index) => ({
    id: heavyUuid('aa1b0001', index + 1),
    teamId: ids.team,
    createdByUserId: ids.owner,
    provider: 'recall',
    platform: 'meet' as const,
    meetingUrl: `https://meet.google.com/heavy-${String(index + 1).padStart(3, '0')}`,
    title: `Heavy seed capture ${String(index + 1).padStart(3, '0')}`,
    status: 'completed' as const,
    defaultVisibility: 'team' as const,
    createdAt: new Date(now.getTime() - index * 120_000),
  }));

  const calendarRows = Array.from({ length: 36 }, (_, index) => ({
    id: heavyUuid('aa1c0001', index + 1),
    teamId: ids.team,
    createdByUserId: ids.owner,
    title: `Heavy seed event ${String(index + 1).padStart(3, '0')}`,
    startAt: new Date(now.getTime() + (index + 1) * 86_400_000),
    endAt: new Date(now.getTime() + (index + 1) * 86_400_000 + 3_600_000),
    timezone: 'UTC',
    visibility: 'team' as const,
  }));

  const chats = Array.from({ length: 60 }, (_, index) => ({
    id: heavyUuid('aa1d0001', index + 1),
    teamId: ids.team,
    createdBy: ids.owner,
    surface: 'web',
    title: `Heavy seed chat ${String(index + 1).padStart(3, '0')}`,
    updatedAt: new Date(now.getTime() - index * 90_000),
  }));

  for (const batch of chunk(events, 80)) {
    await tx.insert(rawEvents).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk([...tasks, ...objects], 80)) {
    await tx.insert(entities).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk([...docs, ...captures], 40)) {
    await tx.insert(documents).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(versions, 40)) {
    await tx.insert(documentVersions).values(batch).onConflictDoNothing();
  }
  for (const version of versions) {
    await tx
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, version.documentId));
  }
  for (const batch of chunk(inbox, 40)) {
    await tx.insert(notifications).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(pins, 30)) {
    await tx.insert(userPins).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(boardCards, 50)) {
    await tx.insert(boardItems).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(meetingRows, 20)) {
    await tx.insert(meetings).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(calendarRows, 20)) {
    await tx.insert(calendarEvents).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(chats, 30)) {
    await tx.insert(chatSessions).values(batch).onConflictDoNothing();
  }
}
