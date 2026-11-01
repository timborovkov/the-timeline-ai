import { z } from 'zod';

const addressSchema = z.object({ email: z.string(), name: z.string().default('') });
const attachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  content: z.instanceof(Buffer),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  contentId: z.string().default(''),
});

/** Provider-independent, hydrated input. No network URLs or webhook secrets. */
export const inboundEmailSchema = z.object({
  providerId: z.string().min(1),
  sentAt: z.string().optional(),
  subject: z.string().default(''),
  from: z.string().default(''),
  fromName: z.string().default(''),
  fromAddress: addressSchema.optional(),
  toAddresses: z.array(addressSchema).default([]),
  ccAddresses: z.array(addressSchema).default([]),
  bccAddresses: z.array(addressSchema).default([]),
  receivedFor: z.array(z.string()).default([]),
  text: z.string().default(''),
  html: z.string().default(''),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  authentication: z
    .object({
      spf: z.string().nullable(),
      dkim: z.string().nullable(),
      dmarc: z.string().nullable(),
    })
    .nullable()
    .default(null),
  attachments: z.array(attachmentSchema).default([]),
  attachmentsDropped: z.array(z.object({ filename: z.string(), reason: z.string() })).default([]),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;
export type InboundAddress = z.infer<typeof addressSchema>;
export type InboundAttachment = z.infer<typeof attachmentSchema>;
