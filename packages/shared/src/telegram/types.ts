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

export const tgMessageSchema = z.object({
  message_id: z.number().int(),
  from: tgUserSchema.optional(),
  chat: tgChatSchema,
  date: z.number().int(),
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

export type TgUser = z.infer<typeof tgUserSchema>;
export type TgChat = z.infer<typeof tgChatSchema>;
export type TgMessage = z.infer<typeof tgMessageSchema>;
export type TgCallbackQuery = z.infer<typeof tgCallbackQuerySchema>;
export type TgUpdate = z.infer<typeof tgUpdateSchema>;
