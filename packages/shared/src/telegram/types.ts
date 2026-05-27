import { z } from 'zod';

// Subset of Telegram Bot API schemas we actually parse. Unknown fields are
// allowed; we only validate the ones we read.

export const tgUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

export const tgChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
  username: z.string().optional(),
});

export const tgAudioPayloadSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  duration: z.number().int().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().optional(),
});

export const tgDocumentPayloadSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().optional(),
});

export const tgPhotoSizeSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  width: z.number().int(),
  height: z.number().int(),
  file_size: z.number().int().optional(),
});

export const tgMessageSchema = z.object({
  message_id: z.number().int(),
  from: tgUserSchema.optional(),
  chat: tgChatSchema,
  date: z.number().int(),
  // Present on edited_message updates; absent on the original send.
  edit_date: z.number().int().optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z
    .array(
      z.object({
        type: z.string(),
        offset: z.number().int(),
        length: z.number().int(),
      }),
    )
    .optional(),
  // Voice memos (recorded in the Telegram client) — almost always audio/ogg
  // with the opus codec. `audio` is set when the user attaches an audio file
  // (e.g. an mp3 from their library). Both flow through the same audio
  // ingest path; we keep them as separate fields so callers can see which.
  voice: tgAudioPayloadSchema.optional(),
  audio: tgAudioPayloadSchema.optional(),
  document: tgDocumentPayloadSchema.optional(),
  photo: z.array(tgPhotoSizeSchema).optional(),
});

export const tgCallbackQuerySchema = z.object({
  id: z.string(),
  from: tgUserSchema,
  message: tgMessageSchema.optional(),
  data: z.string().optional(),
});

export const tgUpdateSchema = z.object({
  update_id: z.number().int(),
  message: tgMessageSchema.optional(),
  edited_message: tgMessageSchema.optional(),
  callback_query: tgCallbackQuerySchema.optional(),
});

export type TgAudioPayload = z.infer<typeof tgAudioPayloadSchema>;
export type TgDocumentPayload = z.infer<typeof tgDocumentPayloadSchema>;
export type TgPhotoSize = z.infer<typeof tgPhotoSizeSchema>;
export type TgUser = z.infer<typeof tgUserSchema>;
export type TgChat = z.infer<typeof tgChatSchema>;
export type TgMessage = z.infer<typeof tgMessageSchema>;
export type TgCallbackQuery = z.infer<typeof tgCallbackQuerySchema>;
export type TgUpdate = z.infer<typeof tgUpdateSchema>;
