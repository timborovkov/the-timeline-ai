import {
  type Db,
  documentVersions,
  documents,
  rawEvents,
  teamMembers,
  teams,
  users,
} from '@timeline/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { meterEmailUnits } from '#src/billing/runtime.js';
import { buildDocumentObjectKey } from '#src/documents/object-key.js';
import {
  chooseContentText,
  getHeader,
  isAudioAttachment,
  normalizeEmail,
  normalizeMessageId,
  parseAuthenticationResults,
  parseForwardedChain,
  parseForwardedFrom,
  parseReferences,
  senderAuthVerdict,
  toParsed,
  toParsedList,
  type ParsedAddress,
} from '#src/email/parser.js';
import {
  postmarkInboundSchema,
  type PostmarkAttachment,
  type PostmarkInbound,
} from '#src/email/postmark-schema.js';
import { childLogger } from '#src/logger.js';
import { inlineSourceSnapshotMetadata } from '#src/reconciliation/source-snapshot.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('email');
const EMAIL_SOURCE_SNAPSHOT_VERSION = 'email-source-snapshot-2026-07';

/**
 * Shape of an attachment upload dependency, mirroring `AudioIngestDeps` from
 * the Telegram dispatcher. The dispatcher stays testable without S3/Redis;
 * when these deps are missing the email still lands but attachments are
 * dropped with a log line and a `attachments_dropped` flag in metadata.
 */
export interface EmailAttachmentDeps {
  /** Upload bytes (decoded from base64) into the attachments bucket. */
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
  /** Per-team inbound address suffix (e.g. `in.thetimeline.cc`). Used as
   *  a last-resort filter so the dispatcher cannot route a stray recipient
   *  that happens to share another team's slug-on-some-other-domain.
   *
   *  Optional in dev: when only `postmarkInboundAddress` is set, recipient
   *  matching is skipped entirely and routing relies on `MailboxHash`. */
  inboundDomain?: string;
  /** Dev / no-own-domain mode. When set, the dispatcher routes by
   *  MailboxHash → team slug instead of (or in addition to) recipient
   *  address matching. Mutually compatible with `inboundDomain` — both
   *  paths are tried; first match wins. */
  postmarkInboundAddress?: string;
  /** RFC 8601 authserv-id allowlist for trusted Authentication-Results
   *  headers. Defense against header-injection spoofing where the email
   *  body itself contains a forged AR header. Empty / undefined means
   *  no AR header is trusted; dispatcher falls back to From-match (dev
   *  behavior). */
  trustedAuthservIds?: string[];
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
 * Entry point: parse a Postmark inbound payload, resolve which teams the
 * mail was addressed to, and write one raw_event per match. Never throws —
 * any failure is logged and surfaced as `{ ok: false, reason }`. The route
 * handler always returns 200 to Postmark so retries are driven by our own
 * idempotency layer (the partial unique index on Message-ID), not by HTTP
 * status drift between deployments.
 */
export async function handleInbound(
  deps: DispatcherDeps,
  rawPayload: unknown,
): Promise<HandleInboundResult> {
  const parsed = postmarkInboundSchema.safeParse(rawPayload);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.slice(0, 3) }, 'payload failed schema validation');
    return { ok: false, inserted: 0, reason: 'invalid_payload' };
  }
  const payload = parsed.data;

  const recipients = collectRecipients(payload);

  // Resolve matching teams from BOTH the MailboxHash and the recipient
  // list, then dedup by team id. A single email can address multiple
  // teams via different mechanisms:
  //   - Plus-addressed to team A (MailboxHash=team-a), CC'd to team B's
  //     real `<slug>@<domain>` address. Both teams need the event.
  //   - To: team-a@<domain>, Cc: team-b@<domain>. Both via recipient.
  //   - Hash-only routing in dev (no inbound domain configured).
  // Skipping the recipient pass when the hash matches would silently drop
  // legitimate CC's to other teams — the "implicit opt-in via CC" pattern
  // the brief calls load-bearing.
  const hashSlug = payload.MailboxHash.trim().toLowerCase();
  const matchedTeams: MatchedTeam[] = [];
  if (hashSlug) {
    const byHash = await resolveTeamBySlug(deps.db, hashSlug);
    if (byHash) matchedTeams.push(byHash);
  }
  if (deps.inboundDomain && recipients.length > 0) {
    const byRecipient = await resolveTeams(deps.db, recipients, deps.inboundDomain);
    for (const t of byRecipient) {
      if (!matchedTeams.some((m) => m.id === t.id)) matchedTeams.push(t);
    }
  }
  if (recipients.length === 0 && !hashSlug) {
    return { ok: false, inserted: 0, reason: 'no_recipients' };
  }
  if (matchedTeams.length === 0) {
    // Common case: a bot scraped the address from somewhere and sent garbage.
    // Don't log every one — Postmark's dashboard already records the delivery.
    return { ok: false, inserted: 0, reason: 'no_matching_team' };
  }

  const senderEmail = inboundSenderEmail(payload);
  const allowedTeams = matchedTeams.filter((team) => {
    if (!team.inboundSenderWhitelistEnabled) return true;
    if (senderEmail && team.inboundSenderWhitelist.includes(senderEmail)) return true;
    log.warn(
      {
        teamId: team.id,
        from: senderEmail,
        messageId:
          normalizeMessageId(getHeader(payload.Headers, 'Message-ID')) ?? payload.MessageID,
      },
      'inbound sender blocked by whitelist',
    );
    return false;
  });
  if (allowedTeams.length === 0) {
    return { ok: false, inserted: 0, reason: 'blocked_sender' };
  }

  // Pre-decode each attachment once. Decoding inside the per-team loop would
  // re-parse the base64 N times when an email is CC'd to multiple team
  // addresses (rare but legitimate).
  const { decoded, dropped } = decodeAttachments(payload.Attachments);

  // Per-team failure tracking. We distinguish two failure modes:
  //   - THROWN: an infrastructure exception bubbled up (DB connection drop,
  //     S3 timeout, transaction abort). The original delivery was NOT
  //     durably accepted; Postmark should retry. Mapped to 5xx by the route.
  //   - RETURNED FALSE: ingestForTeam decided not to land a row for a soft
  //     reason (no members, missing Message-ID, createEmailEvent returned
  //     null). Retry won't help; stays 200.
  // If EVERY matched team threw, we report ok:false so the route surfaces
  // a 5xx to Postmark. Earlier versions returned ok:true unconditionally
  // and silently dropped the inbound during a total DB outage.
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
  if (threwCount > 0 && threwCount === allowedTeams.length) {
    return { ok: false, inserted: 0, reason: 'all_teams_failed' };
  }
  return { ok: true, inserted };
}

function collectRecipients(payload: PostmarkInbound): string[] {
  const out: string[] = [];
  for (const addr of payload.ToFull) {
    const e = normalizeEmail(addr.Email);
    if (e) out.push(e);
  }
  for (const addr of payload.CcFull) {
    const e = normalizeEmail(addr.Email);
    if (e) out.push(e);
  }
  for (const addr of payload.BccFull) {
    const e = normalizeEmail(addr.Email);
    if (e) out.push(e);
  }
  // OriginalRecipient surfaces the actual delivery address when Postmark
  // forwards via an alias chain — it might be present when To/Cc only show
  // a list address. Belt-and-braces.
  const orig = normalizeEmail(payload.OriginalRecipient);
  if (orig && !out.includes(orig)) out.push(orig);
  return Array.from(new Set(out));
}

interface MatchedTeam {
  id: string;
  inboundEmail: string;
  inboundSenderWhitelistEnabled: boolean;
  inboundSenderWhitelist: string[];
}

/**
 * Look up a team by case-insensitive slug match. Used by MailboxHash
 * routing: `<hex>+<slug>@inbound.postmarkapp.com` arrives with
 * `MailboxHash="<slug>"`, and we resolve to the team that owns that slug.
 * Returns null on miss so the dispatcher can fall through to recipient-
 * based resolution.
 */
async function resolveTeamBySlug(db: Db, slug: string): Promise<MatchedTeam | null> {
  const rows = await db
    .select({
      id: teams.id,
      inboundEmail: teams.inboundEmail,
      inboundSenderWhitelistEnabled: teams.inboundSenderWhitelistEnabled,
      inboundSenderWhitelist: teams.inboundSenderWhitelist,
    })
    .from(teams)
    .where(sql`lower(${teams.slug}) = ${slug}`)
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  // `teams.inbound_email` is nullable in schema but set on every Phase 7+
  // team — fall back to a synthetic local string when somehow missing so
  // downstream MatchedTeam.inboundEmail is never undefined (it's only used
  // for logging in this path).
  return {
    id: r.id,
    inboundEmail: r.inboundEmail ?? `${slug}@mailbox-hash`,
    inboundSenderWhitelistEnabled: r.inboundSenderWhitelistEnabled,
    inboundSenderWhitelist: normalizeSenderWhitelist(r.inboundSenderWhitelist),
  };
}

async function resolveTeams(
  db: Db,
  recipients: string[],
  inboundDomain: string,
): Promise<MatchedTeam[]> {
  if (recipients.length === 0) return [];
  // Only consider recipients whose domain matches the configured inbound
  // domain. Stops a stray `someone@gmail.com` in To/Cc from ever colliding
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

function inboundSenderEmail(payload: PostmarkInbound): string {
  return toParsed(payload.FromFull)?.email ?? normalizeEmail(payload.From);
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
  filename: string;
  contentType: string;
  size: number;
  body: Buffer;
  contentId?: string;
}

interface DecodeResult {
  decoded: DecodedAttachment[];
  /** Per-attachment failures. Surfaced on `source_metadata.attachments_dropped`
   *  so the timeline UI can render "N attachments could not be decoded"
   *  instead of silently shrinking the visible attachment list. */
  dropped: { filename: string; reason: string }[];
}

/**
 * Per-payload decoded-bytes cap. Postmark's inbound size limit is 35 MB
 * (base64 encoded → ~46 MB on the wire); the dispatcher decodes everything
 * into Node Buffers in the webhook handler before deciding what to upload.
 * Without a cap, a single 30 MB-attachment email × N parallel webhook hits
 * can OOM the pod. The cap rejects attachments cumulatively: once we cross
 * the threshold, remaining items are dropped with a reason and surface on
 * `source_metadata.attachments_dropped`.
 *
 * Tuned to 25 MB for webhook memory pressure. The transcribe worker can accept
 * larger already-stored audio from S3 and split it before provider upload, but
 * inbound email still decodes attachments in the request path.
 */
const MAX_INBOUND_DECODED_BYTES = 25 * 1024 * 1024;

function decodeAttachments(items: PostmarkAttachment[]): DecodeResult {
  const decoded: DecodedAttachment[] = [];
  const dropped: { filename: string; reason: string }[] = [];
  let totalBytes = 0;
  for (const a of items) {
    // Sanity-check the claimed `ContentLength` against the base64 payload
    // size BEFORE decoding. base64 ≈ 4/3 × raw bytes, so an honest payload
    // satisfies `Content.length ≈ ContentLength × 4 / 3`. A malicious
    // payload that claims `ContentLength: 100` but ships a 500 MB base64
    // string would still allocate the full 500 MB if we trusted `Buffer.from`.
    // We reject when the encoded size > 1.4 × the claimed size × 4/3.
    const expectedEncoded = Math.ceil((a.ContentLength * 4) / 3);
    if (a.Content.length > expectedEncoded * 1.4 + 64) {
      dropped.push({ filename: a.Name, reason: 'content_length_mismatch' });
      continue;
    }
    if (totalBytes + a.ContentLength > MAX_INBOUND_DECODED_BYTES) {
      dropped.push({ filename: a.Name, reason: 'total_size_cap_exceeded' });
      continue;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(a.Content, 'base64');
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'decode_failed';
      log.warn({ name: a.Name, err }, 'attachment base64 decode failed');
      dropped.push({ filename: a.Name, reason });
      continue;
    }
    // Post-decode cross-check: the actual buffer length must roughly match
    // the claimed ContentLength. Catches the same attack from a different
    // angle in case base64 alphabet padding fooled the pre-check.
    if (buf.length > a.ContentLength * 1.1 + 64) {
      dropped.push({ filename: a.Name, reason: 'decoded_size_mismatch' });
      continue;
    }
    totalBytes += buf.length;
    const item: DecodedAttachment = {
      filename: a.Name,
      contentType: a.ContentType,
      size: a.ContentLength,
      body: buf,
    };
    if (a.ContentID) item.contentId = a.ContentID;
    decoded.push(item);
  }
  return { decoded, dropped };
}

/**
 * Ingest a single payload against one matched team. Returns true when a new
 * row landed (false on Postmark retry / dedup so the caller can count
 * accurately). Never throws — captures errors with team context.
 */
async function ingestForTeam(
  deps: DispatcherDeps,
  payload: PostmarkInbound,
  team: MatchedTeam,
  attachments: DecodedAttachment[],
  droppedAttachments: { filename: string; reason: string }[],
): Promise<boolean> {
  // Two distinct identifiers travel with every inbound email:
  //   - The RFC 5322 `Message-ID:` header — the value sending MUAs reference
  //     in `In-Reply-To:` and `References:` for threading. Stable across
  //     forwards, replies, and inbound delivery retries.
  //   - Postmark's `MessageID` field — their own UUID for the delivery
  //     event. Useful as a secondary dedup signal but irrelevant to RFC
  //     threading (no other MUA ever sees it).
  // We MUST store the RFC value as our `message_id` for thread linking to
  // work; otherwise subsequent replies' `In-Reply-To` headers never match
  // anything we've ingested. The Postmark UUID is kept alongside for audit
  // and as a fallback when the source email omitted Message-ID entirely
  // (RFC SHOULD, not MUST — rare in practice but happens for some
  // transactional senders).
  const rfcMessageId = normalizeMessageId(getHeader(payload.Headers, 'Message-ID'));
  const postmarkMessageId = normalizeMessageId(payload.MessageID);
  const messageId = rfcMessageId ?? postmarkMessageId;
  if (!messageId) {
    log.warn({ teamId: team.id }, 'dropping payload with no Message-ID');
    return false;
  }
  const headersInReplyTo = normalizeMessageId(getHeader(payload.Headers, 'In-Reply-To'));
  const referencesRaw = getHeader(payload.Headers, 'References');
  const references = parseReferences(referencesRaw);

  // Sender resolution: first member of the matched team whose primary email
  // matches the From address. Domain-allowlist is a Phase 8 carryover; today
  // we require exact email match.
  //
  // From-spoofing defense: when Postmark (or upstream MTA) passed an
  // `Authentication-Results` header through, we read it. If SPF and DKIM
  // both failed, treat the message as unverified even when From matches a
  // member's email — an attacker forging `From: tim@example.com` can't
  // forge SPF+DKIM for example.com from their own IP. When the header is
  // absent (dev environments, upstream that doesn't sign), preserve the
  // From-match behavior so we don't reject legitimate test traffic.
  const authResults = parseAuthenticationResults(payload.Headers, deps.trustedAuthservIds ?? []);
  const authVerdict = senderAuthVerdict(authResults);
  const fromAddr = toParsed(payload.FromFull) ?? bareFrom(payload);
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
  const visibilityOwnerUserId = senderUnverified
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
  const occurredAt = parseDateHeader(payload.Date) ?? new Date();

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

  // Upload non-audio attachments first (cheap, no enqueue) so the parent
  // email row can carry the metadata. Failures are recorded but don't block
  // ingest — the user can always re-forward the email or fetch attachments
  // from Postmark archives.
  if (deps.attachments) {
    for (let i = 0; i < nonAudio.length; i++) {
      const att = nonAudio[i];
      if (!att) continue;
      // Filename sanitization collapses unsafe characters to `_`, so
      // `evil.txt` and `evil!txt` both become `evil_txt`. Prefix every key
      // with the attachment index to disambiguate collisions within a
      // single email payload — without the prefix the second upload
      // overwrites the first in S3 and the parent's attachments[] points
      // two records at one blob.
      const key = deps.attachments.buildAttachmentKey({
        teamId: team.id,
        messageId,
        filename: `${i}-${att.filename}`,
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
        log.error({ teamId: team.id, key, err }, 'attachment upload failed');
        attachmentsRecords.push({
          filename: att.filename,
          content_type: att.contentType,
          size_bytes: att.size,
          bucket: 'attachments',
          key,
          upload_failed: true,
        });
        const record = attachmentsRecords[attachmentsRecords.length - 1];
        if (record) documentCandidates.push({ attachment: att, record });
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
    subject: payload.Subject,
    textBody: payload.TextBody,
  });
  const forwardedChain = parseForwardedChain({
    subject: payload.Subject,
    textBody: payload.TextBody,
  });

  const baseMetadata: Record<string, unknown> = {
    subject: payload.Subject,
    from: fromAddr,
    to: toParsedList(payload.ToFull),
    cc: toParsedList(payload.CcFull),
    bcc: toParsedList(payload.BccFull),
    html_body: payload.HtmlBody || null,
    attachments: attachmentsRecords,
    raw_postmark: stripRawForStorage(payload),
  };
  Object.assign(
    baseMetadata,
    emailSourcePayloadMetadata({
      payload,
      messageId,
      postmarkMessageId,
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
  // Audit trail: store Postmark's own delivery UUID separately from the RFC
  // Message-ID. Lets us correlate raw_events back to Postmark dashboard
  // entries even when an email is missing the RFC header (we fell back to
  // the Postmark UUID for `message_id`).
  if (postmarkMessageId && postmarkMessageId !== messageId) {
    baseMetadata.postmark_message_id = postmarkMessageId;
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

  if (createResult.deduplicated) {
    // Postmark retry path. The parent raw_event already exists, but we
    // cannot assume the original delivery completed every downstream
    // step — the handler may have crashed AFTER inserting the parent and
    // BEFORE enqueueing extract/embed or uploading attachments. Mirror the
    // Phase 2 Telegram self-heal pattern: idempotently redo the work that
    // is safe to redo. Extract + embed enqueues are worker-side idempotent
    // (the workers skip if facts/embeddings for this event already exist),
    // so re-enqueueing on every retry is a no-op when nothing was missed
    // and a recovery when something was.
    //
    // Attachment re-upload and audio-child creation are NOT redone here:
    // S3 PUT to the same key is idempotent, but creating a second child
    // raw_event for an audio attachment would duplicate the timeline row.
    // The reconciler ticket in todo.md covers the rare "parent landed,
    // children missing" case via a periodic scan.
    await maybeEnqueueExtract(deps, createResult.id, team.id);
    await maybeEnqueueEmbed(deps, createResult.id, team.id);
    if (contentText.trim()) await maybeEnqueueSuggestion(deps, createResult.id, team.id);
    if (
      await processEmailDocumentCandidates(deps, {
        teamId: team.id,
        parentRawEventId: createResult.id,
        parentAuthorUserId: authorUserId,
        visibility: resolvedEmailVisibility,
        visibilityOwnerUserId,
        messageId,
        candidates: documentCandidates,
      })
    ) {
      await patchEmailParentAttachments(deps.db, createResult.id, attachmentsRecords);
    }
    return false;
  }

  const parentEventId = createResult.id;
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
  }
  let parentAttachmentsDirty = false;

  parentAttachmentsDirty = await processEmailDocumentCandidates(deps, {
    teamId: team.id,
    parentRawEventId: parentEventId,
    parentAuthorUserId: authorUserId,
    visibility: resolvedEmailVisibility,
    visibilityOwnerUserId,
    messageId,
    candidates: documentCandidates,
  });

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
        filename: `${i}-${att.filename}`,
      });
      try {
        await deps.attachments.uploadAudio({
          key,
          body: att.body,
          contentType: att.contentType,
        });
      } catch (err) {
        log.error({ teamId: team.id, key, err }, 'audio attachment upload failed');
        continue;
      }
      const child = await scope.timeline.createEvent({
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
        if (allowEnrichment) {
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
        log.error({ err }, 'failed to update parent attachments[]');
      });
  } else if (audioAttachments.length > 0) {
    log.warn(
      { teamId: team.id, count: audioAttachments.length },
      'dropping audio attachments — no upload deps wired',
    );
  }
  if (parentAttachmentsDirty) {
    await patchEmailParentAttachments(deps.db, parentEventId, attachmentsRecords);
  }

  // Enqueue extract + embed for the parent email event. Audio children's
  // extract/embed runs after the transcribe worker completes (Phase 3
  // cascade), so we don't enqueue them here.
  if (allowEnrichment) {
    await maybeEnqueueExtract(deps, parentEventId, team.id);
    await maybeEnqueueEmbed(deps, parentEventId, team.id);
    if (contentText.trim()) await maybeEnqueueSuggestion(deps, parentEventId, team.id);
  }

  return true;
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
      const created = await createEmailDocumentAttachment(deps, documentDeps, {
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
  deps: DispatcherDeps,
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
  const existing = await deps.db
    .select({ documentId: documents.id, versionId: documents.currentVersionId })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, input.teamId),
        eq(documents.sourceRawEventId, input.parentRawEventId),
        sql`${documents.metadata} ->> 'email_message_id' = ${input.messageId}`,
        sql`${documents.metadata} ->> 'filename' = ${input.attachment.filename}`,
      ),
    )
    .limit(1);
  if (existing[0]?.versionId) {
    return { documentId: existing[0].documentId, versionId: existing[0].versionId };
  }

  const created = await deps.db.transaction(async (tx) => {
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
    return { documentId: doc.id, key, versionId: version.id };
  });
  await documentDeps.upload({
    key: created.key,
    body: input.attachment.body,
    contentType: input.attachment.contentType,
  });
  await documentDeps.enqueueExtract({
    documentVersionId: created.versionId,
    teamId: input.teamId,
  });
  return { documentId: created.documentId, versionId: created.versionId };
}

async function patchEmailParentAttachments(
  db: Db,
  parentRawEventId: string,
  records: AttachmentRecordForDocument[],
): Promise<void> {
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
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(eq(rawEvents.id, parentRawEventId))
    .catch((err: unknown) => {
      log.error({ err }, 'failed to update parent document attachments[]');
    });
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

function bareFrom(payload: PostmarkInbound): ParsedAddress | null {
  const email = normalizeEmail(payload.From);
  if (!email) return null;
  const name = payload.FromName.trim();
  return name ? { email, name } : { email };
}

function parseDateHeader(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function emailSourcePayloadMetadata(input: {
  payload: PostmarkInbound;
  messageId: string;
  postmarkMessageId: string | null;
  contentText: string;
  attachments: AttachmentRecordForDocument[];
}): Record<string, unknown> {
  const snapshot = {
    provider: 'postmark',
    source: 'email',
    message_id: input.messageId,
    postmark_message_id: input.postmarkMessageId,
    subject: input.payload.Subject,
    from: input.payload.FromFull,
    to: input.payload.ToFull,
    cc: input.payload.CcFull,
    bcc: input.payload.BccFull,
    date: input.payload.Date,
    text_body: input.payload.TextBody,
    html_body: input.payload.HtmlBody || null,
    content_text: input.contentText,
    raw_postmark: stripRawForStorage(input.payload),
    attachments: input.attachments,
  };
  return inlineSourceSnapshotMetadata({
    snapshot,
    kind: 'postmark_inbound_email',
    version: EMAIL_SOURCE_SNAPSHOT_VERSION,
    ref: (digest) => `inline://timeline/email/${digest.slice('sha256:'.length)}`,
  });
}

/**
 * Drop attachment Content (base64) from the snapshot stored on
 * `source_metadata.raw_postmark`. The bytes already live in S3; re-storing
 * them inline would balloon the JSONB column and make `select *` queries
 * slow. Everything else from Postmark survives so a re-extraction can
 * replay against the full payload.
 */
function stripRawForStorage(payload: PostmarkInbound): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  if (Array.isArray(payload.Attachments)) {
    clone.Attachments = payload.Attachments.map((a) => ({
      Name: a.Name,
      ContentType: a.ContentType,
      ContentLength: a.ContentLength,
      ContentID: a.ContentID,
    }));
  }
  return clone;
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
): Promise<void> {
  if (!deps.extract) return;
  try {
    await deps.extract.enqueueExtract({ rawEventId, teamId });
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
  }
}

async function maybeEnqueueEmbed(
  deps: { db: Db; embed?: EmbedEnqueueDeps },
  rawEventId: string,
  teamId: string,
): Promise<void> {
  if (!deps.embed) return;
  try {
    await deps.embed.enqueueEmbed({ rawEventId, teamId });
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
  }
}

async function maybeEnqueueSuggestion(
  deps: { db: Db; suggestions?: SuggestionEnqueueDeps },
  rawEventId: string,
  teamId: string,
): Promise<void> {
  if (!deps.suggestions) return;
  try {
    await deps.suggestions.enqueueSuggestion({ rawEventId, teamId });
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
  }
}
