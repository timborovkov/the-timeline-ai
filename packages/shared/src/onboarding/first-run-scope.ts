import {
  type Db,
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  documentChunks,
  documentVersions,
  documents,
  rawEvents,
  teamFirstRun,
  teams,
} from '@timeline/db';
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';

import { documentVisibleToUser } from '#src/documents/visibility.js';
import {
  type FirstRunPath,
  type FirstRunPhase,
  type FirstRunScanFailureReason,
  type FirstRunSource,
  type FirstRunState,
  type FirstRunSuggestion,
  type TeamWorkStyle,
  type NamedProcessingStep,
  TEAM_WORK_STYLES,
  FIRST_RUN_PHASES,
  canReplaceFirstRunStarter,
  documentProcessingSteps,
  suggestionTypeRank,
  websiteProcessingSteps,
} from '#src/onboarding/first-run.js';
import { rawEventVisibleToUser } from '#src/visibility.js';

import type { TeamRole } from '#src/team-scope.js';

interface FirstRunScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: TeamRole) => Promise<TeamRole>;
}

const LANDING_CAPTURE_PHASES: FirstRunPhase[] = ['processing', 'failed'];

function isWorkStyle(value: string | null | undefined): value is TeamWorkStyle {
  return Boolean(value && (TEAM_WORK_STYLES as readonly string[]).includes(value));
}

function isPhase(value: string | null | undefined): value is FirstRunPhase {
  return Boolean(value && (FIRST_RUN_PHASES as readonly string[]).includes(value));
}

function mapRow(row: typeof teamFirstRun.$inferSelect, workStyle: string | null): FirstRunState {
  return {
    teamId: row.teamId,
    startedByUserId: row.startedByUserId,
    phase: row.phase,
    starterPath: row.starterPath,
    starterSelectedAt: row.starterSelectedAt,
    captureDocumentId: row.captureDocumentId,
    captureEventId: row.captureEventId,
    websiteUrl: row.websiteUrl,
    websiteHost: row.websiteHost,
    scanFailureReason: row.scanFailureReason,
    guideHiddenAt: row.guideHiddenAt,
    firstCaptureLandedAt: row.firstCaptureLandedAt,
    workStyle: isWorkStyle(workStyle) ? workStyle : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface FirstRunRecordView {
  firstRun: FirstRunState;
  teamName: string;
  inboundEmail: string | null;
  recordTitle: string;
  recordMeta: string;
  summary: string | null;
  note: string;
  sources: FirstRunSource[];
  suggestions: FirstRunSuggestion[];
  processingSteps: NamedProcessingStep[];
  emailArrived: boolean;
}

export function createFirstRunHandlers({ db, teamId, userId, ensureMember }: FirstRunScopeDeps) {
  async function loadState(): Promise<FirstRunState | null> {
    const [row] = await db
      .select({
        firstRun: teamFirstRun,
        workStyle: teams.workStyle,
      })
      .from(teamFirstRun)
      .innerJoin(teams, eq(teams.id, teamFirstRun.teamId))
      .where(eq(teamFirstRun.teamId, teamId))
      .limit(1);
    if (!row) return null;
    return mapRow(row.firstRun, row.workStyle);
  }

  async function touch(
    patch: Partial<typeof teamFirstRun.$inferInsert>,
  ): Promise<FirstRunState | null> {
    await db
      .update(teamFirstRun)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(teamFirstRun.teamId, teamId));
    return loadState();
  }

  async function countSuggestionsForEvents(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await db
      .select({ suggestionId: agentSuggestionEvidence.suggestionId })
      .from(agentSuggestionEvidence)
      .where(
        and(
          eq(agentSuggestionEvidence.teamId, teamId),
          inArray(agentSuggestionEvidence.rawEventId, eventIds),
        ),
      );
    return new Set(rows.map((row) => row.suggestionId)).size;
  }

  async function loadSuggestions(
    eventIds: string[],
    workStyle: TeamWorkStyle | null,
  ): Promise<FirstRunSuggestion[]> {
    if (eventIds.length === 0) return [];
    const evidenceRows = await db
      .select({
        suggestionId: agentSuggestionEvidence.suggestionId,
        rawEventId: agentSuggestionEvidence.rawEventId,
      })
      .from(agentSuggestionEvidence)
      .where(
        and(
          eq(agentSuggestionEvidence.teamId, teamId),
          inArray(agentSuggestionEvidence.rawEventId, eventIds),
        ),
      );
    const suggestionIds = [...new Set(evidenceRows.map((row) => row.suggestionId))];
    if (suggestionIds.length === 0) return [];
    const eventIndex = new Map(eventIds.map((id, index) => [id, index + 1] as const));
    const [suggestionRows, itemRows] = await Promise.all([
      db
        .select()
        .from(agentSuggestions)
        .where(
          and(eq(agentSuggestions.teamId, teamId), inArray(agentSuggestions.id, suggestionIds)),
        ),
      db
        .select()
        .from(agentSuggestionItems)
        .where(
          and(
            eq(agentSuggestionItems.teamId, teamId),
            inArray(agentSuggestionItems.suggestionId, suggestionIds),
          ),
        )
        .orderBy(asc(agentSuggestionItems.createdAt)),
    ]);
    const bySuggestion = new Map(suggestionRows.map((row) => [row.id, row] as const));
    const out: FirstRunSuggestion[] = [];
    for (const item of itemRows) {
      const suggestion = bySuggestion.get(item.suggestionId);
      if (!suggestion) continue;
      const payload =
        item.proposedPayload && typeof item.proposedPayload === 'object'
          ? (item.proposedPayload as { type?: unknown; name?: unknown; title?: unknown })
          : {};
      const type =
        item.targetKind === 'task'
          ? 'Task'
          : typeof payload.type === 'string'
            ? payload.type
            : 'Object';
      const title =
        (typeof payload.name === 'string' && payload.name) ||
        (typeof payload.title === 'string' && payload.title) ||
        item.title ||
        suggestion.title;
      const evidence = evidenceRows.find((row) => row.suggestionId === item.suggestionId);
      const status =
        item.status === 'accepted'
          ? 'accepted'
          : item.status === 'rejected'
            ? 'rejected'
            : suggestion.status === 'partially_resolved'
              ? 'updated'
              : 'pending';
      out.push({
        id: item.id,
        type: type.charAt(0).toUpperCase() + type.slice(1),
        title,
        detail:
          item.description ??
          suggestion.summary ??
          suggestion.reason ??
          'Suggested from this capture',
        sourceN: evidence ? (eventIndex.get(evidence.rawEventId) ?? null) : null,
        status,
      });
    }
    return out.sort(
      (a, b) => suggestionTypeRank(workStyle, a.type) - suggestionTypeRank(workStyle, b.type),
    );
  }

  async function visibleRawEvent(eventId: string): Promise<{ id: string } | null> {
    const [event] = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(
        and(eq(rawEvents.id, eventId), eq(rawEvents.teamId, teamId), rawEventVisibleToUser(userId)),
      )
      .limit(1);
    return event ?? null;
  }

  async function selectStarterPath(
    path: FirstRunPath,
    extras: { websiteUrl?: string; websiteHost?: string; documentId?: string } = {},
  ): Promise<FirstRunState> {
    await ensureMember();
    const now = new Date();
    const phase: FirstRunPhase = path === 'skip' ? 'skipped' : 'processing';
    const current = await loadState();
    if (current && !canReplaceFirstRunStarter(current, path)) {
      return current;
    }
    if (!current) {
      await db.insert(teamFirstRun).values({
        teamId,
        startedByUserId: userId,
        phase,
        starterPath: path,
        starterSelectedAt: now,
        websiteUrl: extras.websiteUrl ?? null,
        websiteHost: extras.websiteHost ?? null,
        captureDocumentId: extras.documentId ?? null,
        scanFailureReason: null,
      });
    } else {
      await touch({
        phase,
        starterPath: path,
        starterSelectedAt: now,
        websiteUrl: extras.websiteUrl ?? null,
        websiteHost: extras.websiteHost ?? null,
        captureDocumentId: extras.documentId ?? current.captureDocumentId,
        captureEventId: path === 'skip' ? null : current.captureEventId,
        scanFailureReason: null,
      });
    }
    const next = await loadState();
    if (!next) throw new Error('Failed to select starter path');
    return next;
  }

  async function attachCapture(input: {
    documentId?: string;
    eventId?: string;
    landed?: boolean;
  }): Promise<FirstRunState> {
    await ensureMember();
    const current = await loadState();
    if (!current) throw new Error('First-run has not started');
    if (
      input.documentId &&
      current.starterPath !== 'document' &&
      !canReplaceFirstRunStarter(current, 'document')
    ) {
      return current;
    }
    const landedAt = input.landed
      ? (current.firstCaptureLandedAt ?? new Date())
      : current.firstCaptureLandedAt;
    const phase =
      input.landed && LANDING_CAPTURE_PHASES.includes(current.phase) ? 'record' : current.phase;
    const next = await touch({
      captureDocumentId: input.documentId ?? current.captureDocumentId,
      captureEventId: input.eventId ?? current.captureEventId,
      firstCaptureLandedAt: landedAt,
      phase,
    });
    if (!next) throw new Error('Failed to attach capture');
    return next;
  }

  async function detectEmailArrival(): Promise<{
    arrived: boolean;
    eventId: string | null;
    firstRun: FirstRunState | null;
  }> {
    await ensureMember();
    const current = await loadState();
    if (current?.starterPath !== 'email') {
      return { arrived: false, eventId: null, firstRun: current };
    }
    if (current.captureEventId) {
      const visible = await visibleRawEvent(current.captureEventId);
      if (!visible) return { arrived: false, eventId: null, firstRun: current };
      return { arrived: true, eventId: current.captureEventId, firstRun: current };
    }
    const since = current.createdAt;
    const [event] = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(rawEvents.source, 'email'),
          gte(rawEvents.createdAt, since),
          rawEventVisibleToUser(userId),
        ),
      )
      .orderBy(desc(rawEvents.createdAt))
      .limit(1);
    if (!event) return { arrived: false, eventId: null, firstRun: current };
    const next = await attachCapture({ eventId: event.id, landed: true });
    return { arrived: true, eventId: event.id, firstRun: next };
  }

  return {
    async getFirstRun(): Promise<FirstRunState | null> {
      await ensureMember();
      return loadState();
    },

    async ensureFirstRun(): Promise<FirstRunState> {
      await ensureMember();
      const existing = await loadState();
      if (existing) return existing;
      await db
        .insert(teamFirstRun)
        .values({ teamId, startedByUserId: userId })
        .onConflictDoNothing();
      const created = await loadState();
      if (!created) throw new Error('Failed to start first-run');
      return created;
    },

    async submitWorkStyle(workStyle: TeamWorkStyle | null): Promise<FirstRunState | null> {
      await ensureMember('member');
      await db.update(teams).set({ workStyle }).where(eq(teams.id, teamId));
      const current = await loadState();
      if (!current) return null;
      if (current.phase === 'welcome') {
        await touch({ phase: 'choose' });
      }
      return loadState();
    },

    selectStarterPath,
    attachCapture,

    async setFirstRunPhase(phase: FirstRunPhase): Promise<FirstRunState> {
      await ensureMember();
      if (!isPhase(phase)) throw new Error('Invalid first-run phase');
      const next = await touch({ phase });
      if (!next) throw new Error('Failed to update first-run phase');
      return next;
    },

    async hideGettingStartedGuide(): Promise<FirstRunState> {
      await ensureMember();
      const next = await touch({ guideHiddenAt: new Date() });
      if (!next) throw new Error('Failed to hide guide');
      return next;
    },

    async markScanFailed(reason: FirstRunScanFailureReason): Promise<FirstRunState> {
      await ensureMember();
      const next = await touch({ phase: 'failed', scanFailureReason: reason });
      if (!next) throw new Error('Failed to record scan failure');
      return next;
    },

    async skipToEmptyHome(): Promise<FirstRunState> {
      await ensureMember();
      return selectStarterPath('skip');
    },

    async completeFirstRun(): Promise<FirstRunState> {
      await ensureMember();
      const next = await touch({ phase: 'complete' });
      if (!next) throw new Error('Failed to complete first-run');
      return next;
    },

    detectEmailArrival,

    async getFirstRunRecord(): Promise<FirstRunRecordView | null> {
      await ensureMember();
      const firstRun = await loadState();
      if (!firstRun) return null;
      const [team] = await db
        .select({ name: teams.name, inboundEmail: teams.inboundEmail })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      const teamName = team?.name ?? 'Your team';
      const inboundEmail = team?.inboundEmail ?? null;

      if (firstRun.starterPath === 'document' && firstRun.captureDocumentId) {
        const [document] = await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.id, firstRun.captureDocumentId),
              eq(documents.teamId, teamId),
              isNull(documents.deletedAt),
              documentVisibleToUser(userId),
            ),
          )
          .limit(1);
        if (!document) {
          return {
            firstRun,
            teamName,
            inboundEmail,
            recordTitle: 'Uploaded document',
            recordMeta: 'Document',
            summary: null,
            note: 'A document is a snapshot. The record starts updating itself once a channel or your email is connected.',
            sources: [],
            suggestions: [],
            processingSteps: documentProcessingSteps('pending', false),
            emailArrived: false,
          };
        }
        const [version] = await db
          .select()
          .from(documentVersions)
          .where(
            and(eq(documentVersions.documentId, document.id), eq(documentVersions.teamId, teamId)),
          )
          .orderBy(desc(documentVersions.version))
          .limit(1);
        const eventId = version?.sourceEventId ?? firstRun.captureEventId;
        const visibleEventId = eventId && (await visibleRawEvent(eventId)) ? eventId : null;
        const eventIds = visibleEventId ? [visibleEventId] : [];
        const chunks = version
          ? await db
              .select({
                chunkIndex: documentChunks.chunkIndex,
                text: documentChunks.text,
              })
              .from(documentChunks)
              .where(
                and(
                  eq(documentChunks.teamId, teamId),
                  eq(documentChunks.documentId, document.id),
                  eq(documentChunks.documentVersionId, version.id),
                ),
              )
              .orderBy(asc(documentChunks.chunkIndex))
              .limit(4)
          : [];
        const suggestions = await loadSuggestions(eventIds, firstRun.workStyle);
        const sources: FirstRunSource[] = chunks.map((chunk, index) => ({
          n: index + 1,
          kind: 'Document',
          title: document.name,
          meta: `chunk ${String(chunk.chunkIndex + 1)}`,
          href: `/app/documents/${document.id}`,
        }));
        if (sources.length === 0 && visibleEventId) {
          sources.push({
            n: 1,
            kind: 'Document',
            title: document.name,
            meta: 'uploaded',
            href: `/app/documents/${document.id}`,
          });
        }
        return {
          firstRun: visibleEventId ? { ...firstRun, captureEventId: visibleEventId } : firstRun,
          teamName,
          inboundEmail,
          recordTitle: document.name,
          recordMeta: 'Document · uploaded',
          summary: chunks[0]?.text.slice(0, 600) ?? null,
          note: 'A document is a snapshot. The record starts updating itself once a channel or your email is connected.',
          sources,
          suggestions,
          processingSteps: documentProcessingSteps(
            version?.processingStatus ?? 'pending',
            suggestions.length > 0,
          ),
          emailArrived: false,
        };
      }

      if (firstRun.starterPath === 'email') {
        const arrival = await detectEmailArrival();
        const state = arrival.firstRun ?? firstRun;
        if (!arrival.eventId) {
          return {
            firstRun: state,
            teamName,
            inboundEmail,
            recordTitle: 'Waiting for your email',
            recordMeta: 'Email',
            summary: null,
            note: 'Send one real thread to your team address. This screen opens the record as soon as it arrives.',
            sources: [],
            suggestions: [],
            processingSteps: [],
            emailArrived: false,
          };
        }
        const [event] = await db
          .select()
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.id, arrival.eventId),
              eq(rawEvents.teamId, teamId),
              rawEventVisibleToUser(userId),
            ),
          )
          .limit(1);
        if (!event) {
          return {
            firstRun: state,
            teamName,
            inboundEmail,
            recordTitle: 'Waiting for your email',
            recordMeta: 'Email',
            summary: null,
            note: 'Send one real thread to your team address. This screen opens the record as soon as it arrives.',
            sources: [],
            suggestions: [],
            processingSteps: [],
            emailArrived: false,
          };
        }
        const suggestions = await loadSuggestions([arrival.eventId], state.workStyle);
        return {
          firstRun: state,
          teamName,
          inboundEmail,
          recordTitle: event.contentText?.split('\n')[0]?.slice(0, 120) ?? 'Forwarded email',
          recordMeta: 'Email · arrived',
          summary: event.contentText?.slice(0, 600) ?? null,
          note: 'One thread is a start. Auto-forwarding or a connected channel keeps it current without anyone forwarding by hand.',
          sources: [
            {
              n: 1,
              kind: 'Email',
              title: 'Forwarded thread',
              meta: event.occurredAt.toISOString().slice(0, 10),
              href: `/app/timeline?event=${arrival.eventId}`,
            },
          ],
          suggestions,
          processingSteps: [],
          emailArrived: true,
        };
      }

      if (firstRun.starterPath === 'website') {
        const eventIds: string[] = [];
        if (firstRun.captureEventId) eventIds.push(firstRun.captureEventId);
        if (firstRun.starterSelectedAt) {
          const pages = await db
            .select({
              id: rawEvents.id,
              contentText: rawEvents.contentText,
              occurredAt: rawEvents.occurredAt,
            })
            .from(rawEvents)
            .where(
              and(
                eq(rawEvents.teamId, teamId),
                eq(rawEvents.source, 'web'),
                gte(rawEvents.createdAt, firstRun.starterSelectedAt),
                rawEventVisibleToUser(userId),
              ),
            )
            .orderBy(asc(rawEvents.createdAt))
            .limit(5);
          for (const page of pages) {
            if (!eventIds.includes(page.id)) eventIds.push(page.id);
          }
          const suggestions = await loadSuggestions(eventIds, firstRun.workStyle);
          const sources: FirstRunSource[] = pages.map((page, index) => ({
            n: index + 1,
            kind: 'Web page',
            title: page.contentText?.split('\n')[0]?.slice(0, 80) ?? `Page ${String(index + 1)}`,
            meta: firstRun.websiteHost ?? '',
            href: `/app/timeline?event=${page.id}`,
          }));
          return {
            firstRun,
            teamName,
            inboundEmail,
            recordTitle: firstRun.websiteHost
              ? `Starter context from ${firstRun.websiteHost}`
              : 'Starter context from your website',
            recordMeta:
              pages.length > 0
                ? `Website · ${String(pages.length)} page${pages.length === 1 ? '' : 's'} read`
                : 'Website',
            summary: pages[0]?.contentText?.slice(0, 600) ?? null,
            note: 'This is your public website, not your team’s work yet. The record starts updating itself once a channel or your email is connected.',
            sources,
            suggestions,
            processingSteps: websiteProcessingSteps({
              host: firstRun.websiteHost,
              failureReason: firstRun.scanFailureReason,
              pageCount: pages.length,
              hasSuggestions: suggestions.length > 0,
            }),
            emailArrived: false,
          };
        }
      }

      return {
        firstRun,
        teamName,
        inboundEmail,
        recordTitle: 'Your workspace',
        recordMeta: '',
        summary: null,
        note: 'Your timeline fills from what your team captures.',
        sources: [],
        suggestions: [],
        processingSteps: [],
        emailArrived: false,
      };
    },

    async refreshDocumentCapture(): Promise<FirstRunState | null> {
      await ensureMember();
      const current = await loadState();
      if (!current?.captureDocumentId || current.starterPath !== 'document') return current;
      const [version] = await db
        .select({
          processingStatus: documentVersions.processingStatus,
          sourceEventId: documentVersions.sourceEventId,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, current.captureDocumentId),
            eq(documentVersions.teamId, teamId),
          ),
        )
        .orderBy(desc(documentVersions.version))
        .limit(1);
      if (!version?.sourceEventId) return current;
      const suggestionCount = await countSuggestionsForEvents([version.sourceEventId]);
      const ready =
        version.processingStatus === 'embedded' ||
        version.processingStatus === 'chunked' ||
        suggestionCount > 0;
      if (!ready && !current.captureEventId) {
        return touch({ captureEventId: version.sourceEventId });
      }
      if (ready) {
        return attachCapture({ eventId: version.sourceEventId, landed: true });
      }
      return current;
    },
  };
}
