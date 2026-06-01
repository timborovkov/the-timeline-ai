import { z } from 'zod';

/**
 * Subset of the Postmark Inbound webhook payload that we actually consume.
 * Postmark sends many more fields (Tag, MessageStream, OriginalRecipient,
 * mailbox-hash details, MailboxHash, raw eml, etc.); they are accepted via
 * the catchall passthrough and stored on `source_metadata.raw_postmark` so a
 * replay can use them without a schema change.
 *
 * Reference: https://postmarkapp.com/developer/webhooks/inbound-webhook
 */
const addressSchema = z.object({
  Email: z.string(),
  Name: z.string().optional().default(''),
  // MailboxHash is present on routed addresses (e.g. user+hash@inbound).
  MailboxHash: z.string().optional().default(''),
});

const headerSchema = z.object({
  Name: z.string(),
  Value: z.string(),
});

const attachmentSchema = z.object({
  Name: z.string(),
  Content: z.string(), // base64-encoded
  ContentType: z.string(),
  ContentLength: z.number().int().nonnegative(),
  // Postmark sets ContentID for inline image parts (cid: references in HTML).
  ContentID: z.string().optional().default(''),
});

export const postmarkInboundSchema = z
  .object({
    MessageID: z.string(),
    Date: z.string().optional(),
    Subject: z.string().optional().default(''),
    From: z.string().optional().default(''),
    FromName: z.string().optional().default(''),
    FromFull: addressSchema.optional(),
    To: z.string().optional().default(''),
    ToFull: z.array(addressSchema).optional().default([]),
    Cc: z.string().optional().default(''),
    CcFull: z.array(addressSchema).optional().default([]),
    Bcc: z.string().optional().default(''),
    BccFull: z.array(addressSchema).optional().default([]),
    OriginalRecipient: z.string().optional().default(''),
    ReplyTo: z.string().optional().default(''),
    MailboxHash: z.string().optional().default(''),
    TextBody: z.string().optional().default(''),
    HtmlBody: z.string().optional().default(''),
    StrippedTextReply: z.string().optional().default(''),
    Tag: z.string().optional().default(''),
    Headers: z.array(headerSchema).optional().default([]),
    Attachments: z.array(attachmentSchema).optional().default([]),
  })
  .loose();

export type PostmarkInbound = z.infer<typeof postmarkInboundSchema>;
export type PostmarkAddress = z.infer<typeof addressSchema>;
export type PostmarkAttachment = z.infer<typeof attachmentSchema>;
