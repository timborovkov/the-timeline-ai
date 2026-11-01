import { createHash } from 'node:crypto';

import {
  type Db,
  documentVersions,
  documents,
  rawEvents,
  teamMembers,
  teams,
  users,
} from '@timeline/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { assertTeamWriteCapacity } from '#src/billing/capacity.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import { meterEmailUnits } from '#src/billing/runtime.js';
import { buildDocumentObjectKey } from '#src/documents/object-key.js';
import {
  inboundEmailSchema,
  type InboundAttachment,
  type InboundEmail,
} from '#src/email/inbound-schema.js';
import {
  chooseContentText,
  getHeader,
  isAudioAttachment,
  normalizeEmail,
  normalizeMessageId,
  parseForwardedChain,
  parseForwardedFrom,
  parseReferences,
  senderAuthVerdict,
  toParsed,
  toParsedList,
  type ParsedAddress,
} from '#src/email/parser.js';
import { childLogger } from '#src/logger.js';
import { inlineSourceSnapshotMetadata } from '#src/reconciliation/source-snapshot.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('email');
const EMAIL_SOURCE_SNAPSHOT_VERSION = 'email-source-snapshot-2026-07';
const BILLING_ENRICHMENT_DEFERRED = 'billing_enrichment_deferred';
const BILLING_ENRICHMENT_CHECKED_AT = 'billing_enrichment_checked_at';

/**
 * Shape of an attachment upload dependency, mirroring `AudioIngestDeps` from
 * the Telegram dispatcher. The dispatcher stays testable without S3/Redis;
 * when these deps are missing the email still lands but attachments are
 * dropped with a log line and a `attachments_dropped` flag in metadata.
 */
export interface EmailAttachmentDeps {
  /** Upload downloaded bytes into the attachments bucket. */
  uploadAttachment(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Upload audio bytes into the audio bucket. Mirrors the Telegram audio path
   *  so an `.m4a` voice memo forwarded as an email attachment lands in the
   *  same bucket as a Telegram voice memo. */
  uploadAudio(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Enqueue a transcribe job. Same shape as the Telegram dispatcher's. */
  enqueueTranscribe(input: { rawEventId: string; teamId: string; audioKey: string }): Promise<void>;
  buildAttachmentKey(input: { teamId: string; messageId: string; filename: string }): string;
  buildAudioKey(input: { teamId: string; messageId: string; filename: string }): string;
}

export interface EmailDocumentDeps {
  upload(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  enqueueExtract(input: { documentVersionId: string; teamId: string }): Promise<void>;
}

export interface ExtractEnqueueDeps {
  enqueueExtract(input: { rawEventId: string; teamId: string }): Promise<void>;
}

export interface EmbedEnqueueDeps {
  enqueueEmbed(input: { rawEventId: string; teamId: string }): Promise<void>;
}

export interface SuggestionEnqueueDeps {
  enqueueSuggestion(input: { rawEventId: string; teamId: string }): Promise<void>;
}

export interface DispatcherDeps {
  db: Db;
  /** Exact receiving domain; shared by custom and Resend-managed domains. */
  inboundDomain?: string;
  attachments?: EmailAttachmentDeps;
  documents?: EmailDocumentDeps;
  extract?: ExtractEnqueueDeps;
  embed?: EmbedEnqueueDeps;
  suggestions?: SuggestionEnqueueDeps;
}

export interface HandleInboundResult {
  ok: boolean;
  /** Number of raw_events rows created across all matched teams. Useful for
   *  test assertions and a single log line per request. */
  inserted: number;
  /** Reason a payload was dropped, when ok=false. */
  reason?: string;
}

/**
 * Log-safe recipient summary: domains plus team slugs (inbound
 * local-part). Never includes a full address or message body.
 */
export function inboundRecipientLogHints(
  recipients: readonly string[],
  inboundDomain?: string,
): { domains: string[]; slugs: string[] } {
  const domains: string[] = [];
  const slugs: string[] = [];
  const seenDomains = new Set<string>();
  const seenSlugs = new Set<string>();

  const addDomain = (value: string) => {
    const domain = value.trim().toLowerCase();
    if (!domain || seenDomains.has(domain)) return;
    seenDomains.add(domain);
    domains.push(domain);
  };
  const addSlug = (value: string) => {
    const slug = value.trim().toLowerCase();
    if (!slug || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);
    slugs.push(slug);
  };

  const configuredDomain = inboundDomain?.trim().toLowerCase();
  const domainSuffix = configuredDomain ? `@${configuredDomain}` : undefined;
  for (const recipient of recipients) {
    const normalized = recipient.trim().toLowerCase();
    const at = normalized.lastIndexOf('@');
    if (at <= 0 || at === normalized.length - 1) continue;
    addDomain(normalized.slice(at + 1));
    const local = normalized.slice(0, at);
    if (!domainSuffix || normalized.endsWith(domainSuffix)) addSlug(local);
  }
  return { domains, slugs };
}

function inboundDropMessage(
  reason: string,
  hints?: { domains: string[]; slugs: string[] },
): string {
  if (!hints) return `inbound email dropped: ${reason}`;
  const domain = hints.domains.join(',') || 'none';
  const slug = hints.slugs.join(',') || 'none';
  return `inbound email dropped: ${reason} domain=${domain} slug=${slug}`;
}

/** Route a hydrated email into scoped events; any failed team requests a worker retry. */
export async function handleInbound(
  deps: DispatcherDeps,
  rawPayload: unknown,
): Promise<HandleInboundResult> {
  const parsed = inboundEmailSchema.safeParse(rawPayload);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.slice(0, 3) }, 'payload failed schema validation');
    return { ok: false, inserted: 0, reason: 'invalid_payload' };
  }
  const payload = parsed.data;

  const recipients = collectRecipients(payload);

  const matchedTeams = deps.inboundDomain
    ? await resolveTeams(deps.db, recipients, deps.inboundDomain)
    : [];
  if (recipients.length === 0) {
    log.info('inbound email dropped: no_recipients');
    return { ok: false, inserted: 0, reason: 'no_recipients' };
  }
  if (matchedTeams.length === 0) {
    const hints = inboundRecipientLogHints(recipients, deps.inboundDomain);
    log.info(
      { recipientDomains: hints.domains, slugs: hints.slugs },
      inboundDropMessage('no_matching_team', hints),
    );
    return { ok: false, inserted: 0, reason: 'no_matching_team' };
  }

  const senderEmail = inboundSenderEmail(payload);
  const allowedTeams: MatchedTeam[] = [];
  for (const team of matchedTeams) {
    let allowed = !team.inboundSenderWhitelistEnabled;
    if (
      !allowed &&
      senderEmail &&
      payload.authentication?.dmarc !== 'fail' &&
      senderAuthVerdict(payload.authentication) !== 'fail'
    ) {
      allowed = team.inboundSenderWhitelist.includes(senderEmail);
      if (!allowed) {
        // Verified webhook routing establishes the team; this system scope only reads
        // current membership, so joins, removals, and email changes take effect immediately.
        const members = await withTeam(deps.db, team.id, '00000000-0000-0000-0000-000000000000', {
          skipMembershipCheck: true,
        }).timeline.listMembers();
        allowed = members.some((member) => normalizeEmail(member.email) === senderEmail);
      }
    }
    if (allowed) {
      allowedTeams.push(team);
      continue;
    }
    log.warn(
      {
        teamId: team.id,
        from: senderEmail,
        messageId:
          normalizeMessageId(getHeader(payload.headers, 'Message-ID')) ?? payload.providerId,
      },
      'inbound sender blocked by whitelist',
    );
  }
  if (allowedTeams.length === 0) {
    return { ok: false, inserted: 0, reason: 'blocked_sender' };
  }

  // Validate the hydrated attachment bytes once before per-team processing.
  const { decoded, dropped } = decodeAttachments(payload.attachments);
  dropped.push(...payload.attachmentsDropped);

  // Retry partial failures too. Successful teams deduplicate and resume downstream work.
  let inserted = 0;
  let threwCount = 0;
  for (const team of allowedTeams) {
    try {
      const didInsert = await ingestForTeam(deps, payload, team, decoded, dropped);
      if (didInsert) inserted += 1;
    } catch (err) {
      threwCount += 1;
      log.error({ teamId: team.id, err }, 'team ingest failed');
    }
  }
  if (threwCount > 0) {
    return { ok: false, inserted: 0, reason: 'team_ingest_failed' };
  }
  return { ok: true, inserted };
}

function collectRecipients(payload: InboundEmail): string[] {
  const out: string[] = [];
  for (const addr of payload.toAddresses) {
    const e = normalizeEmail(addr.email);
    if (e) out.push(e);
  }
  for (const addr of payload.ccAddresses) {
    const e = normalizeEmail(addr.email);
    if (e) out.push(e);
  }
  for (const addr of payload.bccAddresses) {
    const e = normalizeEmail(addr.email);
    if (e) out.push(e);
  }
  for (const recipient of payload.receivedFor) {
    const address = normalizeEmail(recipient);
    if (address) out.push(address);
  }
  return Array.from(new Set(out));
}

interface MatchedTeam {
  id: string;
  inboundEmail: string;
  inboundSenderWhitelistEnabled: boolean;
  inboundSenderWhitelist: string[];
}

async function resolveTeams(
  db: Db,
  recipients: string[],
  inboundDomain: string,
): Promise<MatchedTeam[]> {
  if (recipients.length === 0) return [];
  // Only consider recipients whose domain matches the configured inbound
  // domain. Stops a stray `someone@gmail.com` in to/cc from ever colliding
  // with a team's address that happens to be `someone@gmail.com` (it can't
  // happen with our slug format, but defense in depth is cheap).
  const domainSuffix = '@' + inboundDomain.toLowerCase();
  const candidates = recipients.filter((r) => r.endsWith(domainSuffix));
  if (candidates.length === 0) return [];
  const rows = await db
    .select({
      id: teams.id,
      inboundEmail: teams.inboundEmail,
      inboundSenderWhitelistEnabled: teams.inboundSenderWhitelistEnabled,
      inboundSenderWhitelist: teams.inboundSenderWhitelist,
    })
    .from(teams)
    .where(inArray(teams.inboundEmail, candidates));
  return rows
    .filter((r): r is MatchedTeam => typeof r.inboundEmail === 'string' && Boolean(r.inboundEmail))
    .map((r) => ({
      id: r.id,
      inboundEmail: r.inboundEmail,
      inboundSenderWhitelistEnabled: r.inboundSenderWhitelistEnabled,
      inboundSenderWhitelist: normalizeSenderWhitelist(r.inboundSenderWhitelist),
    }));
}

function inboundSenderEmail(payload: InboundEmail): string {
  return toParsed(payload.fromAddress)?.email ?? normalizeEmail(payload.from);
}

function normalizeSenderWhitelist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const email = normalizeEmail(item);
    if (email) out.add(email);
  }
  return Array.from(out);
}

interface DecodedAttachment {
  id?: string;
  filename: string;
  contentType: string;
  size: number;
  body: Buffer;
  contentId?: string;
}

/** Logical identity survives provider redelivery and attachment order changes. */
function attachmentIdentity(attachment: {
  filename: string;
  contentType: string;
  body: Buffer;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([attachment.filename, attachment.contentType]))
    .update(attachment.body)
    .digest('hex');
}

interface DecodeResult {
  decoded: DecodedAttachment[];
  /** Per-attachment failures. Surfaced on `source_metadata.attachments_dropped`
   *  so the timeline UI can render "N attachments could not be decoded"
   *  instead of silently shrinking the visible attachment list. */
  dropped: { filename: string; reason: string }[];
}

/** Cumulative byte cap, also enforced while downloading in the receiving client. */
const MAX_INBOUND_DECODED_BYTES = 25 * 1024 * 1024;

function decodeAttachments(items: InboundAttachment[]): DecodeResult {
  const decoded: DecodedAttachment[] = [];
  const dropped: { filename: string; reason: string }[] = [];
  let totalBytes = 0;
  for (const a of items) {
    const buf = a.content;
    if (buf.length !== a.size) {
      dropped.push({ filename: a.name, reason: 'content_length_mismatch' });
      continue;
    }
    if (totalBytes + buf.length > MAX_INBOUND_DECODED_BYTES) {
      dropped.push({ filename: a.name, reason: 'total_size_cap_exceeded' });
      continue;
    }
    totalBytes += buf.length;
    const item: DecodedAttachment = {
      id: attachmentIdentity({ filename: a.name, contentType: a.contentType, body: buf }),
      filename: a.name,
      contentType: a.contentType,
      size: a.size,
      body: buf,
    };
    if (a.contentId) item.contentId = a.contentId;
    decoded.push(item);
  }
  return { decoded, dropped };
}

/**
 * Ingest a single payload against one matched team. Returns true when a new
 * row landed (false on Resend retry / dedup so the caller can count
 * accurately). Never throws — captures errors with team context.
 */
async function ingestForTeam(
  deps: DispatcherDeps,
  payload: InboundEmail,
  team: MatchedTeam,
  attachments: DecodedAttachment[],
  droppedAttachments: { filename: string; reason: string }[],
): Promise<boolean> {
  // Two distinct identifiers travel with every inbound email:
  //   - The RFC 5322 `Message-ID:` header — the value sending MUAs reference
  //     in `In-Reply-to:` and `References:` for threading. Stable across
  //     forwards, replies, and inbound delivery retries.
  //   - Resend's `providerId` field — their own UUID for the delivery
  //     event. Useful as a secondary dedup signal but irrelevant to RFC
  //     threading (no other MUA ever sees it).
  // We MUST store the RFC value as our `message_id` for thread linking to
  // work; otherwise subsequent replies' `In-Reply-to` headers never match
  // anything we've ingested. The Resend UUID is kept alongside for audit
  // and as a fallback when the source email omitted Message-ID entirely
  // (RFC SHOULD, not MUST — rare in practice but happens for some
  // transactional senders).
  const rfcMessageId = normalizeMessageId(getHeader(payload.headers, 'Message-ID'));
  const resendMessageId = normalizeMessageId(payload.providerId);
  const messageId = rfcMessageId ?? (resendMessageId ? `resend:${resendMessageId}` : null);
  if (!messageId) {
    log.warn({ teamId: team.id }, 'dropping payload with no Message-ID');
    return false;
  }
  const headersInReplyTo = normalizeMessageId(getHeader(payload.headers, 'In-Reply-to'));
  const referencesRaw = getHeader(payload.headers, 'References');
  const references = parseReferences(referencesRaw);

  // Sender resolution: first member of the matched team whose primary email
  // matches the from address. Domain-allowlist is a Phase 8 carryover; today
  // we require exact email match.
  //
  // Only receiver-computed authentication is trusted. Unknown results preserve
  // the existing member-match policy and remain explicit in the audit metadata.
  const authResults = payload.authentication;
  const authVerdict = senderAuthVerdict(authResults);
  const fromAddr = toParsed(payload.fromAddress) ?? bareFrom(payload);
  let authorUserId: string | null = null;
  let senderUnverified = true;
  if (fromAddr && authVerdict !== 'fail') {
    const memberRows = await deps.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .where(
        and(
          eq(teamMembers.teamId, team.id),
          isNull(teamMembers.removedAt),
          sql`lower(${users.email}) = ${fromAddr.email}`,
        ),
      )
      .limit(1);
    const u = memberRows[0];
    if (u) {
      authorUserId = u.id;
      senderUnverified = false;
    }
  }

  if (senderUnverified) {
    // Structured log line — Phase 7 v1 ships this in place of an
    // owner-digest email. Future Phase 8 outbound mail subscribes here.
    log.warn(
      {
        teamId: team.id,
        from: fromAddr?.email,
        messageId,
        authVerdict,
      },
      'unverified sender accepted',
    );
  }

  // Need a scope to use createEmailEvent; pick an arbitrary team member as
  // the "calling user" since email ingest is a system actor. Use the first
  // owner so requireMembership('member') passes regardless of role hierarchy.
  // This is a system-internal hop, NOT a privilege grant — visibility is
  // 'team' so all members see the row equally.
  const memberRow = await deps.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), isNull(teamMembers.removedAt)))
    .limit(1);
  const callerUserId = memberRow[0]?.userId;
  if (!callerUserId) {
    log.warn({ teamId: team.id }, 'team has no members; cannot ingest');
    return false;
  }
  const scope = withTeam(deps.db, team.id, callerUserId);
  const emailDefault = await scope.timeline.resolveVisibilityDefault('email');
  let visibilityOwnerUserId = senderUnverified
    ? null
    : (authorUserId ?? emailDefault.sourceOwnerUserId ?? null);
  let resolvedEmailVisibility: 'private' | 'team' = 'team';
  if (emailDefault.visibility === 'private' && visibilityOwnerUserId !== null) {
    resolvedEmailVisibility = 'private';
  } else if (emailDefault.visibility === 'specific_users') {
    log.warn(
      { teamId: team.id, source: emailDefault.source },
      'email visibility default must be binary; falling back to team',
    );
  }

  const contentText = chooseContentText(payload);
  const occurredAt = parseDateHeader(payload.sentAt) ?? new Date();

  // Attachment routing: audio attachments are promoted to their own
  // raw_event with content_audio_url + a transcribe job, mirroring the
  // Telegram pipeline. Non-audio attachments are uploaded to the attachments
  // bucket and recorded as metadata on the parent email event.
  interface AttachmentRecord {
    filename: string;
    content_type: string;
    size_bytes: number;
    bucket: 'attachments' | 'audio';
    key: string;
    audio_event_id?: string;
    document_id?: string;
    document_version_id?: string;
    upload_failed?: boolean;
    document_failed?: boolean;
  }
  const attachmentsRecords: AttachmentRecord[] = [];
  const documentCandidates: { attachment: DecodedAttachment; record: AttachmentRecord }[] = [];
  const audioAttachments: DecodedAttachment[] = [];
  const nonAudio: DecodedAttachment[] = [];
  for (const att of attachments) {
    if (isAudioAttachment(att.filename, att.contentType)) audioAttachments.push(att);
    else nonAudio.push(att);
  }

  // Upload before recording metadata; transient storage failures request a retry.
  if (deps.attachments) {
    for (let i = 0; i < nonAudio.length; i++) {
      const att = nonAudio[i];
      if (!att) continue;
      // The content-derived identity prevents filename collisions and is stable
      // when the same RFC message arrives under another provider delivery ID.
      const key = deps.attachments.buildAttachmentKey({
        teamId: team.id,
        messageId,
        filename: `${att.id ?? i}-${att.filename}`,
      });
      try {
        await deps.attachments.uploadAttachment({
          key,
          body: att.body,
          contentType: att.contentType,
        });
        attachmentsRecords.push({
          filename: att.filename,
          content_type: att.contentType,
          size_bytes: att.size,
          bucket: 'attachments',
          key,
        });
        const record = attachmentsRecords[attachmentsRecords.length - 1];
        if (record) documentCandidates.push({ attachment: att, record });
      } catch (err) {
        throw err;
      }
    }
  } else if (nonAudio.length > 0) {
    log.warn(
      { teamId: team.id, count: nonAudio.length },
      'dropping non-audio attachments — no upload deps wired',
    );
    for (const att of nonAudio) {
      const record: AttachmentRecord = {
        filename: att.filename,
        content_type: att.contentType,
        size_bytes: att.size,
        bucket: 'attachments',
        key: '',
        upload_failed: true,
      };
      attachmentsRecords.push(record);
      documentCandidates.push({ attachment: att, record });
    }
  }

  // Build the email event's source_metadata. Thread fields are added by
  // team-scope.createEmailEvent inside the transaction.
  const forwardedFrom = parseForwardedFrom({
    subject: payload.subject,
    textBody: payload.text,
  });
  const forwardedChain = parseForwardedChain({
    subject: payload.subject,
    textBody: payload.text,
  });

  const baseMetadata: Record<string, unknown> = {
    subject: payload.subject,
    from: fromAddr,
    to: toParsedList(payload.toAddresses),
    cc: toParsedList(payload.ccAddresses),
    bcc: toParsedList(payload.bccAddresses),
    html_body: payload.html || null,
    attachments: attachmentsRecords,
    raw_resend: stripRawForStorage(payload),
  };
  Object.assign(
    baseMetadata,
    emailSourcePayloadMetadata({
      payload,
      messageId,
      resendMessageId,
      contentText,
      attachments: attachmentsRecords,
    }),
  );
  if (forwardedFrom) baseMetadata.forwarded_from = forwardedFrom;
  if (forwardedChain.length > 0) baseMetadata.forwarded_chain = forwardedChain;
  if (senderUnverified) baseMetadata.sender_unverified = true;
  // Auth audit trail. `auth_verdict` captures the upstream verification
  // result so a security review can distinguish "no auth signal" (dev
  // traffic) from "auth failed" (spoof attempt). Stamped on every email
  // row, not just unverified ones.
  baseMetadata.auth_verdict = authVerdict;
  if (authResults) baseMetadata.auth_results = authResults;
  if (droppedAttachments.length > 0) baseMetadata.attachments_dropped = droppedAttachments;
  // Audit trail: store Resend's own delivery UUID separately from the RFC
  // Message-ID. Lets us correlate raw_events back to Resend dashboard
  // entries even when an email is missing the RFC header (we fell back to
  // the Resend UUID for `message_id`).
  if (resendMessageId && resendMessageId !== messageId) {
    baseMetadata.resend_message_id = resendMessageId;
  }

  const createResult = await scope.timeline.createEmailEvent({
    authorUserId,
    messageId,
    inReplyTo: headersInReplyTo,
    references,
    contentText,
    occurredAt,
    visibility: resolvedEmailVisibility,
    visibilityOwnerUserId,
    sourceMetadata: baseMetadata,
  });
  if (!createResult) {
    log.warn({ teamId: team.id, messageId }, 'createEmailEvent returned null');
    return false;
  }

  if (createResult.deduplicated) log.debug({ teamId: team.id }, 'inbound email dropped: dedup hit');
  // Run the same replay-safe downstream path for first delivery and recovery.
  const parentEventId = createResult.id;
  if (createResult.deduplicated) {
    const [stored] = await deps.db
      .select({
        visibility: rawEvents.visibility,
        owner: rawEvents.visibilityOwnerUserId,
        metadata: rawEvents.sourceMetadata,
      })
      .from(rawEvents)
      .where(and(eq(rawEvents.id, parentEventId), eq(rawEvents.teamId, team.id)))
      .limit(1);
    if (!stored) throw new Error('email_parent_missing');
    // A different provider delivery with the same RFC ID cannot append content
    // to the original immutable capture. Its own job remains responsible for recovery.
    const storedMetadata = (stored.metadata ?? {}) as Record<string, unknown>;
    if (storedMetadata.resend_message_id !== payload.providerId) return false;
    resolvedEmailVisibility = stored.visibility === 'private' ? 'private' : 'team';
    visibilityOwnerUserId = stored.owner;
  }

  const emailMeter = await meterEmailUnits({
    db: deps.db,
    teamId: team.id,
    ...(authorUserId ? { userId: authorUserId } : {}),
    operationId: `email_in:${messageId}`,
    units: 1,
    operationClass: 'email_inbound',
  });
  const allowEnrichment = emailMeter.ok;
  if (!allowEnrichment) {
    log.warn(
      { teamId: team.id, code: emailMeter.code, messageId },
      'inbound email stored without AI enrichment; email meter admission failed',
    );
    await stampEmailBillingEnrichmentDeferred(deps.db, parentEventId);
  }
  let parentAttachmentsDirty = false;

  parentAttachmentsDirty = allowEnrichment
    ? await processEmailDocumentCandidates(deps, {
        teamId: team.id,
        parentRawEventId: parentEventId,
        parentAuthorUserId: authorUserId,
        visibility: resolvedEmailVisibility,
        visibilityOwnerUserId,
        messageId,
        candidates: documentCandidates,
      })
    : false;

  // Promote each audio attachment to its own raw_event + transcribe job.
  // These are created via createEvent (not createEmailEvent) because the
  // child rows aren't part of the email thread — they're audio captures
  // that happen to share a Message-ID with their parent.
  if (deps.attachments && audioAttachments.length > 0) {
    for (let i = 0; i < audioAttachments.length; i++) {
      const att = audioAttachments[i];
      if (!att) continue;
      // Same disambiguation as the non-audio path: index-prefix the key
      // so two audio attachments with names that sanitize to the same
      // string don't collide in S3.
      const key = deps.attachments.buildAudioKey({
        teamId: team.id,
        messageId,
        filename: `${att.id ?? i}-${att.filename}`,
      });
      try {
        await deps.attachments.uploadAudio({
          key,
          body: att.body,
          contentType: att.contentType,
        });
      } catch (err) {
        throw err;
      }
      const child = await scope.timeline.createEvent({
        idempotencyKey: `email-audio:${messageId}:${att.id ?? i}`,
        authorUserId,
        source: 'email',
        contentAudioUrl: key,
        occurredAt,
        visibility: resolvedEmailVisibility,
        visibilityOwnerUserId,
        sourceMetadata: {
          parent_event_id: parentEventId,
          email_message_id: messageId,
          audio_filename: att.filename,
          audio_mime_type: att.contentType,
          audio_file_size: att.size,
          ...(allowEnrichment ? {} : { transcription_deferred: true }),
        },
      });
      // Record back into the parent's attachments[] so the timeline UI
      // can link the audio child without scanning the whole table.
      attachmentsRecords.push({
        filename: att.filename,
        content_type: att.contentType,
        size_bytes: att.size,
        bucket: 'audio',
        key,
        audio_event_id: child.id,
      });
      parentAttachmentsDirty = true;

      try {
        const [storedChild] = await deps.db
          .select({ metadata: rawEvents.sourceMetadata })
          .from(rawEvents)
          .where(and(eq(rawEvents.id, child.id), eq(rawEvents.teamId, team.id)))
          .limit(1);
        const childMetadata = (storedChild?.metadata ?? {}) as Record<string, unknown>;
        if (allowEnrichment && typeof childMetadata.transcribed_at !== 'string') {
          await deps.attachments.enqueueTranscribe({
            rawEventId: child.id,
            teamId: team.id,
            audioKey: key,
          });
        }
      } catch (err) {
        log.error({ teamId: team.id, err }, 'transcribe enqueue failed');
        const failurePatch = JSON.stringify({
          transcription_failed_at: new Date().toISOString(),
          transcription_error: `enqueue failed: ${
            err instanceof Error ? err.message.slice(0, 480) : 'unknown'
          }`,
        });
        await deps.db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
          })
          .where(eq(rawEvents.id, child.id))
          .catch((markErr: unknown) => {
            log.error({ err: markErr }, 'failed to mark transcribe failure');
          });
        throw err;
      }
    }
    // Persist the updated attachments[] back onto the parent (the original
    // insert wrote `attachmentsRecords` before audio children existed; now
    // we know their event ids).
    parentAttachmentsDirty = false;
    const patch = JSON.stringify({ attachments: attachmentsRecords });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, parentEventId))
      .catch((err: unknown) => {
        throw err;
      });
  } else if (audioAttachments.length > 0) {
    log.warn(
      { teamId: team.id, count: audioAttachments.length },
      'dropping audio attachments — no upload deps wired',
    );
  }
  if (parentAttachmentsDirty) {
    if (!(await patchEmailParentAttachments(deps.db, parentEventId, attachmentsRecords)))
      throw new Error('email_attachment_link_failed');
  }

  // Enqueue extract + embed for the parent email event. Audio children's
  // extract/embed runs after the transcribe worker completes (Phase 3
  // cascade), so we don't enqueue them here.
  if (allowEnrichment) {
    if (!(await maybeEnqueueExtract(deps, parentEventId, team.id)))
      throw new Error('email_extract_enqueue_failed');
    if (!(await maybeEnqueueEmbed(deps, parentEventId, team.id)))
      throw new Error('email_embed_enqueue_failed');
    if (contentText.trim() && !(await maybeEnqueueSuggestion(deps, parentEventId, team.id)))
      throw new Error('email_suggestion_enqueue_failed');
  }

  return !createResult.deduplicated;
}

async function processEmailDocumentCandidates(
  deps: DispatcherDeps,
  input: {
    teamId: string;
    parentRawEventId: string;
    parentAuthorUserId: string | null;
    visibility: 'private' | 'team';
    visibilityOwnerUserId: string | null;
    messageId: string;
    candidates: { attachment: DecodedAttachment; record: AttachmentRecordForDocument }[];
  },
): Promise<boolean> {
  const documentDeps = deps.documents;
  if (!documentDeps || input.candidates.length === 0) return false;
  let dirty = false;
  for (const candidate of input.candidates) {
    try {
      const created = await createEmailDocumentAttachment(deps.db, documentDeps, {
        teamId: input.teamId,
        parentRawEventId: input.parentRawEventId,
        parentAuthorUserId: input.parentAuthorUserId,
        visibility: input.visibility,
        visibilityOwnerUserId: input.visibilityOwnerUserId,
        messageId: input.messageId,
        attachment: candidate.attachment,
      });
      candidate.record.document_id = created.documentId;
      candidate.record.document_version_id = created.versionId;
      dirty = true;
    } catch (err) {
      log.error(
        { teamId: input.teamId, parentRawEventId: input.parentRawEventId, err },
        'email document attachment failed',
      );
      if (!(err instanceof BillingAdmissionError)) throw err;
      candidate.record.document_failed = true;
      dirty = true;
    }
  }
  return dirty;
}

interface AttachmentRecordForDocument {
  filename: string;
  content_type: string;
  size_bytes: number;
  bucket: 'attachments' | 'audio';
  key: string;
  audio_event_id?: string;
  document_id?: string;
  document_version_id?: string;
  upload_failed?: boolean;
  document_failed?: boolean;
}

async function createEmailDocumentAttachment(
  db: Db,
  documentDeps: EmailDocumentDeps,
  input: {
    teamId: string;
    parentRawEventId: string;
    parentAuthorUserId: string | null;
    visibility: 'private' | 'team';
    visibilityOwnerUserId: string | null;
    messageId: string;
    attachment: DecodedAttachment;
  },
): Promise<{ documentId: string; versionId: string }> {
  const existing = await db
    .select({
      documentId: documents.id,
      versionId: documents.currentVersionId,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, input.teamId),
        eq(documents.sourceRawEventId, input.parentRawEventId),
        sql`${documents.metadata} ->> 'email_message_id' = ${input.messageId}`,
        sql`${documents.metadata} ->> 'attachment_id' = ${attachmentIdentity(input.attachment)}`,
      ),
    )
    .limit(1);
  const stored = existing[0];
  if (stored?.versionId) {
    return completeEmailDocumentAttachment(db, documentDeps, input, {
      documentId: stored.documentId,
      versionId: stored.versionId,
      metadata: stored.metadata,
    });
  }

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.teamId}, 1))`);
    const [raced] = await tx
      .select({ documentId: documents.id, versionId: documents.currentVersionId })
      .from(documents)
      .where(
        and(
          eq(documents.teamId, input.teamId),
          eq(documents.sourceRawEventId, input.parentRawEventId),
          sql`${documents.metadata} ->> 'attachment_id' = ${attachmentIdentity(input.attachment)}`,
        ),
      )
      .limit(1);
    if (raced?.versionId)
      return {
        documentId: raced.documentId,
        versionId: raced.versionId,
        objectKey: buildDocumentObjectKey({
          teamId: input.teamId,
          documentId: raced.documentId,
          version: 1,
          filename: input.attachment.filename,
        }),
      };

    await assertTeamWriteCapacity({
      db: tx as unknown as typeof db,
      teamId: input.teamId,
      additionalDocuments: 1,
      additionalBytes: input.attachment.size,
    });
    const docRows = await tx
      .insert(documents)
      .values({
        teamId: input.teamId,
        fileKind: 'captured',
        name: input.attachment.filename,
        ownerUserId: input.parentAuthorUserId ?? input.visibilityOwnerUserId,
        visibility: input.visibility,
        sourceRawEventId: input.parentRawEventId,
        metadata: {
          source: 'email',
          email_message_id: input.messageId,
          filename: input.attachment.filename,
          attachment_id: attachmentIdentity(input.attachment),
          parent_raw_event_id: input.parentRawEventId,
        },
      })
      .returning({ id: documents.id });
    const doc = docRows[0];
    if (!doc) throw new Error('email_document_insert_failed');
    const key = buildDocumentObjectKey({
      teamId: input.teamId,
      documentId: doc.id,
      version: 1,
      filename: input.attachment.filename,
    });
    const versionRows = await tx
      .insert(documentVersions)
      .values({
        teamId: input.teamId,
        documentId: doc.id,
        version: 1,
        objectKey: key,
        byteSize: input.attachment.body.length,
        contentType: input.attachment.contentType,
        uploadedByUserId: input.parentAuthorUserId,
        sourceEventId: input.parentRawEventId,
        processingStatus: 'pending',
      })
      .returning({ id: documentVersions.id, objectKey: documentVersions.objectKey });
    const version = versionRows[0];
    if (!version) throw new Error('email_document_version_insert_failed');
    await tx
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, doc.id));
    return { documentId: doc.id, objectKey: key, versionId: version.id };
  });
  return completeEmailDocumentAttachment(db, documentDeps, input, {
    documentId: created.documentId,
    versionId: created.versionId,
    objectKey: created.objectKey,
    metadata: null,
  });
}

/**
 * Upload and extract enqueue are separate from the document row insert. A
 * retry must finish whichever of those steps did not stick before the caller
 * treats the attachment as captured. Flags live on document metadata so a
 * later retry does not upload again once the bytes are stored.
 */
async function completeEmailDocumentAttachment(
  db: Db,
  documentDeps: EmailDocumentDeps,
  input: {
    teamId: string;
    attachment: DecodedAttachment;
  },
  stored: {
    documentId: string;
    versionId: string;
    objectKey?: string;
    metadata: unknown;
  },
): Promise<{ documentId: string; versionId: string }> {
  const flags = emailDocumentStoredFlags(stored.metadata);
  if (!flags.bytesStored) {
    const objectKey = stored.objectKey ?? (await emailDocumentObjectKey(db, stored.versionId));
    await documentDeps.upload({
      key: objectKey,
      body: input.attachment.body,
      contentType: input.attachment.contentType,
    });
    await markEmailDocumentStored(db, stored.documentId, { bytes_stored: true });
  }
  if (!flags.extractEnqueued) {
    await documentDeps.enqueueExtract({
      documentVersionId: stored.versionId,
      teamId: input.teamId,
    });
    await markEmailDocumentStored(db, stored.documentId, { extract_enqueued: true });
  }
  return { documentId: stored.documentId, versionId: stored.versionId };
}

function emailDocumentStoredFlags(metadata: unknown): {
  bytesStored: boolean;
  extractEnqueued: boolean;
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { bytesStored: false, extractEnqueued: false };
  }
  const record = metadata as Record<string, unknown>;
  return {
    bytesStored: record.bytes_stored === true,
    extractEnqueued: record.extract_enqueued === true,
  };
}

async function emailDocumentObjectKey(db: Db, versionId: string): Promise<string> {
  const [version] = await db
    .select({ objectKey: documentVersions.objectKey })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  if (!version) throw new Error('email_document_version_missing');
  return version.objectKey;
}

async function markEmailDocumentStored(
  db: Db,
  documentId: string,
  patch: { bytes_stored?: true; extract_enqueued?: true },
): Promise<void> {
  const stamp = JSON.stringify(patch);
  await db
    .update(documents)
    .set({
      metadata: sql`COALESCE(${documents.metadata}, '{}'::jsonb) || ${stamp}::jsonb`,
    })
    .where(eq(documents.id, documentId));
}

async function patchEmailParentAttachments(
  db: Db,
  parentRawEventId: string,
  records: AttachmentRecordForDocument[],
): Promise<boolean> {
  const current = await db
    .select({ sourceMetadata: rawEvents.sourceMetadata })
    .from(rawEvents)
    .where(eq(rawEvents.id, parentRawEventId))
    .limit(1);
  const metadata = current[0]?.sourceMetadata;
  const existing =
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    Array.isArray((metadata as Record<string, unknown>).attachments)
      ? ((metadata as Record<string, unknown>).attachments as unknown[])
      : [];
  const merged = mergeAttachmentRecords(existing, records);
  const patch = JSON.stringify({ attachments: merged });
  try {
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, parentRawEventId));
  } catch (err) {
    log.error({ err }, 'failed to update parent document attachments[]');
    return false;
  }
  return true;
}

function mergeAttachmentRecords(
  existing: unknown[],
  updates: AttachmentRecordForDocument[],
): unknown[] {
  const merged = [...existing];
  for (const update of updates) {
    const index = merged.findIndex(
      (candidate) => attachmentRecordKey(candidate) === attachmentKey(update),
    );
    if (index === -1) {
      merged.push(update);
      continue;
    }
    const current = merged[index];
    merged[index] =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current, ...update }
        : update;
  }
  return merged;
}

function attachmentRecordKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.filename !== 'string') return null;
  if (typeof record.content_type !== 'string') return null;
  if (typeof record.bucket !== 'string') return null;
  const key = typeof record.key === 'string' ? record.key : '';
  return attachmentKey({
    filename: record.filename,
    content_type: record.content_type,
    bucket: record.bucket === 'audio' ? 'audio' : 'attachments',
    key,
  });
}

function attachmentKey(input: {
  filename: string;
  content_type: string;
  bucket: 'attachments' | 'audio';
  key: string;
}): string {
  return `${input.bucket}\0${input.key}\0${input.filename}\0${input.content_type}`;
}

function bareFrom(payload: InboundEmail): ParsedAddress | null {
  const email = normalizeEmail(payload.from);
  if (!email) return null;
  const name = payload.fromName.trim();
  return name ? { email, name } : { email };
}

function parseDateHeader(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function emailSourcePayloadMetadata(input: {
  payload: InboundEmail;
  messageId: string;
  resendMessageId: string | null;
  contentText: string;
  attachments: AttachmentRecordForDocument[];
}): Record<string, unknown> {
  const snapshot = {
    provider: 'resend',
    source: 'email',
    message_id: input.messageId,
    resend_message_id: input.resendMessageId,
    subject: input.payload.subject,
    from: input.payload.fromAddress,
    to: input.payload.toAddresses,
    cc: input.payload.ccAddresses,
    bcc: input.payload.bccAddresses,
    date: input.payload.sentAt,
    text_body: input.payload.text,
    html_body: input.payload.html || null,
    content_text: input.contentText,
    raw_resend: stripRawForStorage(input.payload),
    attachments: input.attachments,
  };
  return inlineSourceSnapshotMetadata({
    snapshot,
    kind: 'resend_inbound_email',
    version: EMAIL_SOURCE_SNAPSHOT_VERSION,
    ref: (digest) => `inline://timeline/email/${digest.slice('sha256:'.length)}`,
  });
}

/**
 * Drop attachment bytes from the snapshot stored on
 * `source_metadata.raw_resend`. The bytes already live in S3; re-storing
 * them inline would balloon the JSONB column and make `select *` queries
 * slow. Normalized source fields remain available for previews and reconciliation.
 */
function stripRawForStorage(payload: InboundEmail): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  if (Array.isArray(payload.attachments)) {
    clone.attachments = payload.attachments.map((a) => ({
      ...(a.id ? { id: a.id } : {}),
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      contentId: a.contentId,
    }));
  }
  return clone;
}

async function stampEmailBillingEnrichmentDeferred(db: Db, eventId: string): Promise<void> {
  const patch = JSON.stringify({ [BILLING_ENRICHMENT_DEFERRED]: true });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(eq(rawEvents.id, eventId));
}

export interface DeferredEmailEnrichmentIo {
  enqueueExtract?: (input: { rawEventId: string; teamId: string }) => Promise<void>;
  enqueueEmbed?: (input: { rawEventId: string; teamId: string }) => Promise<void>;
  enqueueSuggestion?: (input: { rawEventId: string; teamId: string }) => Promise<void>;
  documents?: EmailDocumentDeps;
  readAttachment?: (input: { key: string }) => Promise<Buffer>;
}

async function defaultDeferredEmailEnrichmentIo(): Promise<DeferredEmailEnrichmentIo> {
  const queues = await import('#src/queue/queues.js');
  const io: DeferredEmailEnrichmentIo = {
    enqueueExtract: async (input) => {
      await queues.enqueueExtractJob(input);
    },
    enqueueEmbed: async (input) => {
      await queues.enqueueEmbedJob({
        scope: 'raw_event',
        teamId: input.teamId,
        rawEventId: input.rawEventId,
      });
    },
    enqueueSuggestion: async (input) => {
      await queues.enqueueSuggestionJob(input);
    },
  };
  try {
    const { getAttachmentsBucket, getDocumentsBucket, getS3Client } =
      await import('#src/s3/client.js');
    const { getObjectBuffer, putObject } = await import('#src/s3/objects.js');
    const client = getS3Client();
    io.readAttachment = async ({ key }) => {
      const { body } = await getObjectBuffer(client, getAttachmentsBucket(), key);
      return body;
    };
    io.documents = {
      async upload(input) {
        await putObject(client, {
          bucket: getDocumentsBucket(),
          key: input.key,
          body: input.body,
          contentType: input.contentType,
        });
      },
      enqueueExtract: async (input) => {
        await queues.enqueueDocumentExtractJob(input);
      },
    };
  } catch (err) {
    log.warn({ err }, 'deferred email flush: document/S3 deps unavailable');
  }
  return io;
}

function emailMessageIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const messageId = (metadata as Record<string, unknown>).message_id;
  return typeof messageId === 'string' && messageId.trim() ? messageId : null;
}

function pendingEmailDocumentRecords(metadata: unknown): AttachmentRecordForDocument[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const attachments = (metadata as Record<string, unknown>).attachments;
  if (!Array.isArray(attachments)) return [];
  const pending: AttachmentRecordForDocument[] = [];
  for (const item of attachments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.filename !== 'string' || typeof record.content_type !== 'string') continue;
    if (record.bucket === 'audio') continue;
    if (typeof record.document_id === 'string') continue;
    if (record.upload_failed === true) continue;
    pending.push({
      filename: record.filename,
      content_type: record.content_type,
      size_bytes: typeof record.size_bytes === 'number' ? record.size_bytes : 0,
      bucket: 'attachments',
      key: typeof record.key === 'string' ? record.key : '',
    });
  }
  return pending;
}

/**
 * Retry inbound-email extract/embed/suggestions (and captured documents) after
 * a denied `email_units` meter. Tests pass `io` so this does not need Redis/S3.
 */
export async function flushDeferredEmailEnrichment(
  db: Db,
  limit = 50,
  io?: DeferredEmailEnrichmentIo,
): Promise<number> {
  const resolved = io ?? (await defaultDeferredEmailEnrichmentIo());
  let flushed = 0;
  const maxScan = Math.max(limit * 20, 200);
  let scanned = 0;
  while (flushed < limit && scanned < maxScan) {
    const rows = await db
      .select({
        id: rawEvents.id,
        teamId: rawEvents.teamId,
        authorUserId: rawEvents.authorUserId,
        contentText: rawEvents.contentText,
        visibility: rawEvents.visibility,
        visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
        sourceMetadata: rawEvents.sourceMetadata,
      })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.source, 'email'),
          isNull(rawEvents.contentAudioUrl),
          sql`${rawEvents.sourceMetadata}->>'billing_enrichment_deferred' = 'true'`,
          sql`COALESCE(${rawEvents.sourceMetadata}->>'deleted', 'false') <> 'true'`,
        ),
      )
      .orderBy(
        sql`COALESCE(${rawEvents.sourceMetadata}->>'billing_enrichment_checked_at', '')`,
        asc(rawEvents.id),
      )
      .limit(Math.min(limit, maxScan - scanned));
    if (rows.length === 0) break;
    let progressed = false;
    for (const row of rows) {
      scanned += 1;
      const messageId = emailMessageIdFromMetadata(row.sourceMetadata);
      if (!messageId) {
        const stamp = JSON.stringify({
          [BILLING_ENRICHMENT_CHECKED_AT]: new Date().toISOString(),
        });
        await db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${stamp}::jsonb`,
          })
          .where(eq(rawEvents.id, row.id));
        continue;
      }
      const metered = await meterEmailUnits({
        db,
        teamId: row.teamId,
        ...(row.authorUserId ? { userId: row.authorUserId } : {}),
        operationId: `email_in:${messageId}`,
        units: 1,
        operationClass: 'email_inbound',
      });
      if (!metered.ok) {
        const stamp = JSON.stringify({
          [BILLING_ENRICHMENT_CHECKED_AT]: new Date().toISOString(),
        });
        await db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${stamp}::jsonb`,
          })
          .where(eq(rawEvents.id, row.id));
        continue;
      }
      const enqueued = [
        await maybeEnqueueExtract(
          {
            db,
            ...(resolved.enqueueExtract
              ? { extract: { enqueueExtract: resolved.enqueueExtract } }
              : {}),
          },
          row.id,
          row.teamId,
        ),
        await maybeEnqueueEmbed(
          {
            db,
            ...(resolved.enqueueEmbed ? { embed: { enqueueEmbed: resolved.enqueueEmbed } } : {}),
          },
          row.id,
          row.teamId,
        ),
      ];
      if (row.contentText?.trim()) {
        enqueued.push(
          await maybeEnqueueSuggestion(
            {
              db,
              ...(resolved.enqueueSuggestion
                ? { suggestions: { enqueueSuggestion: resolved.enqueueSuggestion } }
                : {}),
            },
            row.id,
            row.teamId,
          ),
        );
      }
      if (enqueued.some((ok) => !ok)) {
        const stamp = JSON.stringify({
          [BILLING_ENRICHMENT_CHECKED_AT]: new Date().toISOString(),
        });
        await db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${stamp}::jsonb`,
          })
          .where(eq(rawEvents.id, row.id));
        continue;
      }
      const documents = resolved.documents;
      const pending = pendingEmailDocumentRecords(row.sourceMetadata);
      let attachmentRecoveryIncomplete = !documents && pending.length > 0;
      let attachmentsLinked = true;
      if (documents) {
        const updated: AttachmentRecordForDocument[] = [];
        for (const record of pending) {
          let body: Buffer | undefined;
          if (record.key) {
            try {
              body = await resolved.readAttachment?.({ key: record.key });
            } catch (err) {
              log.warn(
                { err, key: record.key, eventId: row.id },
                'deferred email attachment read failed',
              );
              attachmentRecoveryIncomplete = true;
              continue;
            }
          }
          if (!body) {
            attachmentRecoveryIncomplete = true;
            continue;
          }
          try {
            const created = await createEmailDocumentAttachment(db, documents, {
              teamId: row.teamId,
              parentRawEventId: row.id,
              parentAuthorUserId: row.authorUserId,
              visibility: row.visibility === 'private' ? 'private' : 'team',
              visibilityOwnerUserId: row.visibilityOwnerUserId,
              messageId,
              attachment: {
                filename: record.filename,
                contentType: record.content_type,
                size: body.length,
                body,
              },
            });
            updated.push({
              ...record,
              document_id: created.documentId,
              document_version_id: created.versionId,
            });
          } catch (err) {
            log.error({ err, eventId: row.id }, 'deferred email document attachment failed');
            attachmentRecoveryIncomplete = true;
          }
        }
        if (updated.length > 0) {
          attachmentsLinked = await patchEmailParentAttachments(db, row.id, updated);
        }
      }
      if (attachmentRecoveryIncomplete || !attachmentsLinked) {
        const stamp = JSON.stringify({
          [BILLING_ENRICHMENT_CHECKED_AT]: new Date().toISOString(),
        });
        await db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${stamp}::jsonb`,
          })
          .where(eq(rawEvents.id, row.id));
        continue;
      }
      const clear = JSON.stringify({
        [BILLING_ENRICHMENT_DEFERRED]: false,
        [BILLING_ENRICHMENT_CHECKED_AT]: new Date().toISOString(),
      });
      await db
        .update(rawEvents)
        .set({
          sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${clear}::jsonb`,
        })
        .where(eq(rawEvents.id, row.id));
      flushed += 1;
      progressed = true;
      if (flushed >= limit) break;
    }
    if (!progressed && rows.length < limit) break;
  }
  return flushed;
}

/**
 * Mirror of `maybeEnqueueExtract` in the Telegram dispatcher. Same failure
 * patch shape so the timeline UI can render "extraction unavailable"
 * uniformly across sources.
 */
async function maybeEnqueueExtract(
  deps: { db: Db; extract?: ExtractEnqueueDeps },
  rawEventId: string,
  teamId: string,
): Promise<boolean> {
  if (!deps.extract) return true;
  try {
    await deps.extract.enqueueExtract({ rawEventId, teamId });
    return true;
  } catch (err) {
    log.error({ err }, 'extract enqueue failed');
    const failurePatch = JSON.stringify({
      extraction_failed_at: new Date().toISOString(),
      extraction_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark extract failure');
      });
    return false;
  }
}

async function maybeEnqueueEmbed(
  deps: { db: Db; embed?: EmbedEnqueueDeps },
  rawEventId: string,
  teamId: string,
): Promise<boolean> {
  if (!deps.embed) return true;
  try {
    await deps.embed.enqueueEmbed({ rawEventId, teamId });
    return true;
  } catch (err) {
    log.error({ err }, 'embed enqueue failed');
    const failurePatch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark embed failure');
      });
    return false;
  }
}

async function maybeEnqueueSuggestion(
  deps: { db: Db; suggestions?: SuggestionEnqueueDeps },
  rawEventId: string,
  teamId: string,
): Promise<boolean> {
  if (!deps.suggestions) return true;
  try {
    await deps.suggestions.enqueueSuggestion({ rawEventId, teamId });
    return true;
  } catch (err) {
    log.error({ err }, 'suggestion enqueue failed');
    const failurePatch = JSON.stringify({
      suggestions_failed_at: new Date().toISOString(),
      suggestions_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark suggestion failure');
      });
    return false;
  }
}
