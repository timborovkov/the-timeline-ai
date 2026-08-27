import { PGlite } from '@electric-sql/pglite';
import {
  documentVersions,
  documents,
  rawEvents,
  reconciliationEvidence,
  teamMembers,
  teams,
  teamVisibilityDefaults,
  users,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PostmarkInbound } from '#src/email/postmark-schema.js';

import { insertRestrictedFreeBillingAccount } from '#src/billing/capacity.js';
import { handleInbound } from '#src/email/dispatcher.js';
import { applyDbMigrations } from '#src/test/pglite.js';
import { textQueueDeps } from '#src/test/queue-deps.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function inboundPayload(messageId: string): PostmarkInbound {
  return {
    MessageID: `postmark-${messageId}`,
    Date: '2026-05-27T09:00:00Z',
    Subject: 'Vendor note',
    From: 'vendor@example.net',
    FromName: 'Vendor',
    FromFull: { Email: 'vendor@example.net', Name: 'Vendor', MailboxHash: '' },
    To: 'team-a@inbound.test',
    ToFull: [{ Email: 'team-a@inbound.test', Name: 'Team A', MailboxHash: '' }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: '',
    ReplyTo: '',
    MailboxHash: 'team-a',
    TextBody: 'Please review this.',
    HtmlBody: '',
    StrippedTextReply: '',
    Tag: '',
    Headers: [{ Name: 'Message-ID', Value: `<${messageId}@example.net>` }],
    Attachments: [],
  };
}

function attachment(name: string, contentType: string, body = 'hello') {
  const bytes = Buffer.from(body);
  return {
    Name: name,
    Content: bytes.toString('base64'),
    ContentType: contentType,
    ContentLength: bytes.length,
    ContentID: '',
  };
}

function attachmentDeps() {
  return {
    uploadAttachment: vi.fn().mockResolvedValue(undefined),
    uploadAudio: vi.fn().mockResolvedValue(undefined),
    enqueueTranscribe: vi.fn().mockResolvedValue(undefined),
    buildAttachmentKey: vi.fn(({ teamId, messageId, filename }) => {
      return `attachments/${teamId}/${messageId}/${filename}`;
    }),
    buildAudioKey: vi.fn(({ teamId, messageId, filename }) => {
      return `audio/${teamId}/${messageId}/${filename}`;
    }),
  };
}

function documentDeps() {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    enqueueExtract: vi.fn().mockResolvedValue(undefined),
  };
}

describe('email dispatcher', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);

    await db.insert(teams).values({
      id: TEAM_ID,
      slug: 'team-a',
      name: 'Team A',
      inboundEmail: 'team-a@inbound.test',
    });
    await db.insert(users).values({ id: USER_ID, email: 'member@example.com' });
    await db.insert(teamMembers).values({
      teamId: TEAM_ID,
      userId: USER_ID,
      role: 'owner',
    });
  });

  afterEach(async () => {
    await pg.close();
  });

  it('creates a team-scoped email raw event with sender metadata and text queues', async () => {
    const queues = textQueueDeps();

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', ...queues },
        inboundPayload('vendor-note'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row).toMatchObject({
      source: 'email',
      teamId: TEAM_ID,
      authorUserId: null,
      contentText: 'Please review this.',
      visibility: 'team',
    });
    expect(row?.sourceMetadata).toMatchObject({
      subject: 'Vendor note',
      from: { email: 'vendor@example.net', name: 'Vendor' },
      to: [{ email: 'team-a@inbound.test', name: 'Team A' }],
      message_id: 'vendor-note@example.net',
      auth_verdict: 'absent',
      sender_unverified: true,
      source_snapshot_kind: 'postmark_inbound_email',
      source_snapshot_version: 'email-source-snapshot-2026-07',
    });
    const metadata = row?.sourceMetadata as Record<string, unknown>;
    const sourcePayloadRef = metadata.source_payload_ref;
    const payloadDigest = metadata.payload_digest;
    expect(typeof sourcePayloadRef).toBe('string');
    expect(typeof payloadDigest).toBe('string');
    if (typeof sourcePayloadRef !== 'string' || typeof payloadDigest !== 'string') {
      throw new Error('expected email replay metadata');
    }
    expect(sourcePayloadRef).toMatch(/^inline:\/\/timeline\/email\/[0-9a-f]{64}$/);
    expect(payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(metadata.source_snapshot).toMatchObject({
      provider: 'postmark',
      source: 'email',
      message_id: 'vendor-note@example.net',
      subject: 'Vendor note',
      content_text: 'Please review this.',
      raw_postmark: {
        MessageID: 'postmark-vendor-note',
        Subject: 'Vendor note',
      },
    });
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(reconciliationEvidence.rawEventId, row?.id ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(evidence).toMatchObject({
      source: 'email',
      provider: 'email',
      externalObjectId: 'vendor-note@example.net',
      eventType: 'email.received',
      sourcePayloadRef,
      payloadDigest,
      replayState: 'full',
      visibility: 'team',
    });
    expect(queues.extract.enqueueExtract).toHaveBeenCalledWith({
      rawEventId: row?.id,
      teamId: TEAM_ID,
    });
    expect(queues.embed.enqueueEmbed).toHaveBeenCalledWith({
      rawEventId: row?.id,
      teamId: TEAM_ID,
    });
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: row?.id,
      teamId: TEAM_ID,
    });
  });

  it('stores forwarded chains as structured metadata and extraction-visible text', async () => {
    const queues = textQueueDeps();
    const payload = inboundPayload('forwarded-chain');
    payload.Subject = 'Fwd: Launch checklist';
    payload.StrippedTextReply = 'Team, see the customer thread below.';
    payload.TextBody = [
      'Team, see the customer thread below.',
      '',
      '---------- Forwarded message ---------',
      'From: Ada Lovelace <ada@example.com>',
      'Date: Wed, Jun 17, 2026 at 2:15 PM',
      'Subject: Re: Launch checklist',
      'To: Tim <tim@team.example>',
      '',
      'The launch checklist is approved.',
      '',
      '---------- Forwarded message ---------',
      'From: Grace Hopper <grace@example.com>',
      'Date: Wed, Jun 17, 2026 at 1:03 PM',
      'Subject: Launch checklist',
      'To: Ada <ada@example.com>',
      '',
      'Please confirm the rollout window.',
    ].join('\n');

    await expect(
      handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row?.contentText).toContain('Team, see the customer thread below.');
    expect(row?.contentText).toContain('From: Ada Lovelace <ada@example.com>');
    expect(row?.contentText).toContain('The launch checklist is approved.');
    expect(row?.contentText).toContain('Please confirm the rollout window.');
    expect(row?.sourceMetadata).toMatchObject({
      forwarded_from: { email: 'ada@example.com', name: 'Ada Lovelace' },
      forwarded_chain: [
        expect.objectContaining({
          from: { email: 'ada@example.com', name: 'Ada Lovelace' },
          subject: 'Re: Launch checklist',
          body: 'The launch checklist is approved.',
        }),
        expect.objectContaining({
          from: { email: 'grace@example.com', name: 'Grace Hopper' },
          subject: 'Launch checklist',
          body: 'Please confirm the rollout window.',
        }),
      ],
    });
  });

  it('allows whitelisted senders case-insensitively when the whitelist is enabled', async () => {
    await db
      .update(teams)
      .set({
        inboundSenderWhitelistEnabled: true,
        inboundSenderWhitelist: ['Vendor@Example.NET'],
      })
      .where(eq(teams.id, TEAM_ID));
    const queues = textQueueDeps();

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', ...queues },
        inboundPayload('whitelisted-vendor'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(rows).toHaveLength(1);
    expect(queues.extract.enqueueExtract).toHaveBeenCalledOnce();
  });

  it('blocks non-whitelisted senders before raw events or agent work', async () => {
    await db
      .update(teams)
      .set({
        inboundSenderWhitelistEnabled: true,
        inboundSenderWhitelist: ['member@example.com'],
      })
      .where(eq(teams.id, TEAM_ID));
    const queues = textQueueDeps();

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', ...queues },
        inboundPayload('blocked-vendor'),
      ),
    ).resolves.toMatchObject({ ok: false, inserted: 0, reason: 'blocked_sender' });

    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(0);
    expect(queues.extract.enqueueExtract).not.toHaveBeenCalled();
    expect(queues.embed.enqueueEmbed).not.toHaveBeenCalled();
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('applies sender whitelist independently for multi-team CC ingest', async () => {
    await db.insert(teams).values({
      id: OTHER_TEAM_ID,
      slug: 'team-b',
      name: 'Team B',
      inboundEmail: 'team-b@inbound.test',
      inboundSenderWhitelistEnabled: true,
      inboundSenderWhitelist: ['partner@example.net'],
    });
    await db.insert(teamMembers).values({
      teamId: OTHER_TEAM_ID,
      userId: USER_ID,
      role: 'owner',
    });
    await db
      .update(teams)
      .set({
        inboundSenderWhitelistEnabled: true,
        inboundSenderWhitelist: ['vendor@example.net'],
      })
      .where(eq(teams.id, TEAM_ID));
    const payload = inboundPayload('cc-two-teams');
    payload.MailboxHash = '';
    payload.CcFull = [{ Email: 'team-b@inbound.test', Name: 'Team B', MailboxHash: '' }];
    const queues = textQueueDeps();

    await expect(
      handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.teamId).toBe(TEAM_ID);
    expect(queues.extract.enqueueExtract).toHaveBeenCalledOnce();
  });

  it('attributes verified member senders and honors private email defaults', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'private',
      sourceOwnerUserId: USER_ID,
    });
    const payload = inboundPayload('member-note');
    payload.From = 'member@example.com';
    payload.FromName = 'Timeline Member';
    payload.FromFull = {
      Email: 'member@example.com',
      Name: 'Timeline Member',
      MailboxHash: '',
    };
    payload.Headers.push({
      Name: 'Authentication-Results',
      Value: 'mx.test; spf=pass smtp.mailfrom=example.com; dkim=fail',
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', trustedAuthservIds: ['mx.test'] },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row).toMatchObject({
      authorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
    expect(row?.sourceMetadata).toMatchObject({ auth_verdict: 'pass' });
    expect(row?.sourceMetadata).not.toMatchObject({ sender_unverified: true });
  });

  it('treats spoofed member senders as unverified team-visible events', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'private',
      sourceOwnerUserId: USER_ID,
    });
    const payload = inboundPayload('spoofed-member');
    payload.From = 'member@example.com';
    payload.FromName = 'Timeline Member';
    payload.FromFull = {
      Email: 'member@example.com',
      Name: 'Timeline Member',
      MailboxHash: '',
    };
    payload.Headers.push({
      Name: 'Authentication-Results',
      Value: 'mx.test; spf=fail smtp.mailfrom=bad.test; dkim=fail',
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', trustedAuthservIds: ['mx.test'] },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row).toMatchObject({
      authorUserId: null,
      visibility: 'team',
      visibilityOwnerUserId: null,
    });
    expect(row?.sourceMetadata).toMatchObject({
      auth_verdict: 'fail',
      sender_unverified: true,
    });
  });

  it('deduplicates duplicate deliveries and re-attempts text queues for recovery', async () => {
    const queues = textQueueDeps();
    const payload = inboundPayload('duplicate-note');

    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);
    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(rows).toHaveLength(1);
    expect(queues.extract.enqueueExtract).toHaveBeenCalledTimes(2);
    expect(queues.embed.enqueueEmbed).toHaveBeenCalledTimes(2);
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledTimes(2);
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenLastCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_ID,
    });
  });

  it('records non-audio attachment metadata without direct suggestions when no text exists', async () => {
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const payload = inboundPayload('attachment-only');
    payload.TextBody = '';
    payload.Attachments = [attachment('proposal.pdf', 'application/pdf', '%PDF-1.7')];

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', attachments, ...queues },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    expect(attachments.uploadAttachment).toHaveBeenCalledOnce();
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(row?.sourceMetadata).toMatchObject({
      attachments: [
        expect.objectContaining({
          filename: 'proposal.pdf',
          content_type: 'application/pdf',
          bucket: 'attachments',
        }),
      ],
    });
  });

  it('promotes non-audio attachments into captured documents and extraction work', async () => {
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const document = documentDeps();
    const payload = inboundPayload('customer-doc');
    payload.TextBody = 'Customer forwarded the signed rollout plan.';
    payload.Attachments = [attachment('rollout-plan.pdf', 'application/pdf', '%PDF-1.7')];

    await expect(
      handleInbound(
        {
          db: db as never,
          inboundDomain: 'inbound.test',
          attachments,
          documents: document,
          ...queues,
        },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [parent] = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(parent?.contentText).toBe('Customer forwarded the signed rollout plan.');
    const [captured] = await db.select().from(documents).where(eq(documents.teamId, TEAM_ID));
    expect(captured).toMatchObject({
      fileKind: 'captured',
      name: 'rollout-plan.pdf',
      ownerUserId: null,
      visibility: 'team',
      sourceRawEventId: parent?.id,
    });
    expect(captured?.metadata).toMatchObject({
      source: 'email',
      email_message_id: 'customer-doc@example.net',
      parent_raw_event_id: parent?.id,
    });
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(
        eq(documentVersions.documentId, captured?.id ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(version).toMatchObject({
      teamId: TEAM_ID,
      documentId: captured?.id,
      version: 1,
      contentType: 'application/pdf',
      sourceEventId: parent?.id,
      processingStatus: 'pending',
    });
    expect(document.upload).toHaveBeenCalledWith({
      key: version?.objectKey,
      body: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    });
    expect(document.enqueueExtract).toHaveBeenCalledWith({
      documentVersionId: version?.id,
      teamId: TEAM_ID,
    });
    expect(parent?.sourceMetadata).toMatchObject({
      attachments: [
        expect.objectContaining({
          filename: 'rollout-plan.pdf',
          bucket: 'attachments',
          document_id: captured?.id,
          document_version_id: version?.id,
        }),
      ],
    });
    expect(queues.extract.enqueueExtract).toHaveBeenCalledWith({
      rawEventId: parent?.id,
      teamId: TEAM_ID,
    });
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: parent?.id,
      teamId: TEAM_ID,
    });
  });

  it('skips document extraction when inbound-email admission fails', async () => {
    const billing = createBillingScope({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.settle({
      operationId: 'fill-email',
      meterId: 'email_units',
      nativeUnits: 500,
      customerChargeCents: 0,
    });
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const document = documentDeps();
    const payload = inboundPayload('over-cap-doc');
    payload.Attachments = [attachment('rollout-plan.pdf', 'application/pdf', '%PDF-1.7')];

    await expect(
      handleInbound(
        {
          db: db as never,
          inboundDomain: 'inbound.test',
          attachments,
          documents: document,
          ...queues,
        },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    expect(document.enqueueExtract).not.toHaveBeenCalled();
    expect(document.upload).not.toHaveBeenCalled();
    const captured = await db.select().from(documents).where(eq(documents.teamId, TEAM_ID));
    expect(captured).toHaveLength(0);
    expect(queues.extract.enqueueExtract).not.toHaveBeenCalled();
    expect(queues.embed.enqueueEmbed).not.toHaveBeenCalled();
  });

  it('repairs missing captured documents on duplicate email delivery replay', async () => {
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const document = documentDeps();
    const payload = inboundPayload('customer-doc-replay');
    payload.TextBody = 'Customer forwarded the implementation notes.';
    payload.Attachments = [attachment('implementation-notes.pdf', 'application/pdf', '%PDF-1.7')];

    await handleInbound(
      { db: db as never, inboundDomain: 'inbound.test', attachments, ...queues },
      payload,
    );
    await expect(
      handleInbound(
        {
          db: db as never,
          inboundDomain: 'inbound.test',
          attachments,
          documents: document,
          ...queues,
        },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 0 });

    const parentRows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(parentRows).toHaveLength(1);
    const [parent] = parentRows;
    const capturedRows = await db.select().from(documents).where(eq(documents.teamId, TEAM_ID));
    expect(capturedRows).toHaveLength(1);
    const [captured] = capturedRows;
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(
        eq(documentVersions.documentId, captured?.id ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(captured).toMatchObject({
      fileKind: 'captured',
      name: 'implementation-notes.pdf',
      sourceRawEventId: parent?.id,
    });
    expect(version?.sourceEventId).toBe(parent?.id);
    expect(document.enqueueExtract).toHaveBeenCalledWith({
      documentVersionId: version?.id,
      teamId: TEAM_ID,
    });
    expect(parent?.sourceMetadata).toMatchObject({
      attachments: [
        expect.objectContaining({
          filename: 'implementation-notes.pdf',
          document_id: captured?.id,
          document_version_id: version?.id,
        }),
      ],
    });
  });

  it('promotes audio attachments to child raw events and transcription work', async () => {
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const payload = inboundPayload('audio-note');
    payload.TextBody = 'Voice memo context';
    payload.Attachments = [attachment('memo.m4a', 'audio/mp4', 'audio-bytes')];

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', attachments, ...queues },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    expect(attachments.uploadAudio).toHaveBeenCalledOnce();
    expect(attachments.enqueueTranscribe).toHaveBeenCalledOnce();
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledOnce();
    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(rows).toHaveLength(2);
    const parent = rows.find((r) => r.contentText === 'Voice memo context');
    const child = rows.find((r) => r.contentAudioUrl);
    expect(parent?.sourceMetadata).toMatchObject({
      attachments: [
        expect.objectContaining({
          filename: 'memo.m4a',
          bucket: 'audio',
          audio_event_id: child?.id,
        }),
      ],
    });
    expect(child).toMatchObject({
      teamId: TEAM_ID,
      authorUserId: null,
      visibility: 'team',
    });
    expect(child?.contentAudioUrl).toContain('memo.m4a');
    expect(attachments.enqueueTranscribe).toHaveBeenCalledWith({
      rawEventId: child?.id,
      teamId: TEAM_ID,
      audioKey: child?.contentAudioUrl,
    });
  });

  it('stores inbound email audio without transcribe when the email meter is denied', async () => {
    await insertRestrictedFreeBillingAccount({ db: db as never, teamId: TEAM_ID });
    const queues = textQueueDeps();
    const attachments = attachmentDeps();
    const payload = inboundPayload('audio-deferred');
    payload.TextBody = 'Voice memo context';
    payload.Attachments = [attachment('memo.m4a', 'audio/mp4', 'audio-bytes')];

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', attachments, ...queues },
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    expect(attachments.uploadAudio).toHaveBeenCalledOnce();
    expect(attachments.enqueueTranscribe).not.toHaveBeenCalled();
    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    const child = rows.find((r) => r.contentAudioUrl);
    expect(child?.sourceMetadata).toMatchObject({ transcription_deferred: true });
  });

  it('does not create raw events or agent work for malformed, unmatched, or memberless payloads', async () => {
    const queues = textQueueDeps();

    await expect(
      handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, { nope: true }),
    ).resolves.toMatchObject({ ok: false, inserted: 0, reason: 'invalid_payload' });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', ...queues },
        {
          ...inboundPayload('unknown-team'),
          MailboxHash: '',
          ToFull: [{ Email: 'missing@inbound.test', Name: '', MailboxHash: '' }],
        },
      ),
    ).resolves.toMatchObject({ ok: false, inserted: 0, reason: 'no_matching_team' });

    await db.delete(teamMembers).where(eq(teamMembers.teamId, TEAM_ID));
    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test', ...queues },
        inboundPayload('memberless-team'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 0 });

    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(0);
    expect(queues.extract.enqueueExtract).not.toHaveBeenCalled();
    expect(queues.embed.enqueueEmbed).not.toHaveBeenCalled();
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('falls back to team visibility for unverified private email with no real owner', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'private',
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test' },
        inboundPayload('vendor-note'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row?.source).toBe('email');
    expect(row?.authorUserId).toBeNull();
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityOwnerUserId).toBeNull();
  });

  it('treats unexpected email specific-users defaults as binary team visibility', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'specific_users',
      visibilityUserIds: [USER_ID],
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test' },
        inboundPayload('specific-users-default'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });
});
