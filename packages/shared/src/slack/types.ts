import { z } from 'zod';

export const slackFileSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    mimetype: z.string().optional(),
    filetype: z.string().optional(),
    url_private_download: z.string().optional(),
    url_private: z.string().optional(),
    size: z.number().int().optional(),
  })
  .passthrough();

export const slackMessageEventSchema = z
  .object({
    type: z.literal('message'),
    subtype: z.string().optional(),
    channel: z.string(),
    channel_type: z.string().optional(),
    user: z.string().optional(),
    bot_id: z.string().optional(),
    text: z.string().optional(),
    ts: z.string(),
    event_ts: z.string().optional(),
    thread_ts: z.string().optional(),
    message: z
      .object({
        user: z.string().optional(),
        bot_id: z.string().optional(),
        text: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
        files: z.array(slackFileSchema).optional(),
      })
      .passthrough()
      .optional(),
    previous_message: z
      .object({
        user: z.string().optional(),
        text: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
      })
      .passthrough()
      .optional(),
    deleted_ts: z.string().optional(),
    files: z.array(slackFileSchema).optional(),
  })
  .passthrough();

export const slackAppMentionEventSchema = z
  .object({
    type: z.literal('app_mention'),
    channel: z.string(),
    user: z.string().optional(),
    text: z.string().optional(),
    ts: z.string(),
    event_ts: z.string().optional(),
    thread_ts: z.string().optional(),
    channel_type: z.string().optional(),
  })
  .passthrough();

export const slackEventCallbackSchema = z
  .object({
    type: z.literal('event_callback'),
    token: z.string().optional(),
    team_id: z.string().optional(),
    api_app_id: z.string().optional(),
    event_id: z.string(),
    event_time: z.number().int().optional(),
    event: z.union([slackMessageEventSchema, slackAppMentionEventSchema]),
  })
  .passthrough();

export const slackUrlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
});

export const slackEnvelopeSchema = z.union([slackUrlVerificationSchema, slackEventCallbackSchema]);

export type SlackFile = z.infer<typeof slackFileSchema>;
export type SlackMessageEvent = z.infer<typeof slackMessageEventSchema>;
export type SlackAppMentionEvent = z.infer<typeof slackAppMentionEventSchema>;
export type SlackEventCallback = z.infer<typeof slackEventCallbackSchema>;
export type SlackEnvelope = z.infer<typeof slackEnvelopeSchema>;
