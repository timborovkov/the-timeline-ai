import { z } from 'zod';

export const DEFAULT_UPDATE_KEY = 'default';
export const HOME_UPDATE_KEY = 'home';

export const UPDATE_SECTIONS = [
  {
    value: 'activity',
    label: 'What happened',
    description: 'Progress, conversations and decisions',
  },
  { value: 'due', label: 'Upcoming tasks', description: 'Open tasks with an approaching due date' },
  {
    value: 'calendar',
    label: 'Upcoming meetings',
    description: 'Scheduled meetings and calendar events',
  },
  { value: 'savedViews', label: 'Saved views', description: 'New matches for views you follow' },
] as const;

export const UPDATE_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const UPDATE_CHANNELS = [
  { value: 'workspace', label: 'Workspace destinations' },
  { value: 'email', label: 'Email' },
  { value: 'telegram', label: 'Telegram DM' },
  { value: 'slack', label: 'Slack DM' },
] as const;

export const updateSettingsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((name) => !/[\r\n]/.test(name)),
    enabled: z.boolean(),
    cadence: z.enum(['daily', 'weekly']),
    weekday: z.number().int().min(1).max(7),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    channel: z.enum(['workspace', 'email', 'telegram', 'slack']),
    detail: z.enum(['brief', 'detailed']),
    includeContent: z.boolean().default(false),
    lookbackDays: z.number().int().min(1).max(14),
    upcomingDays: z.number().int().min(1).max(14),
    sections: z
      .array(z.enum(['activity', 'due', 'calendar', 'savedViews']))
      .min(1)
      .max(4),
  })
  .strict()
  .refine((settings) => new Set(settings.sections).size === settings.sections.length);

export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
export type UpdateSection = UpdateSettings['sections'][number];
export type UpdateChannel = UpdateSettings['channel'];

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  name: 'Daily update',
  enabled: true,
  cadence: 'daily',
  weekday: 1,
  time: '12:00',
  channel: 'workspace',
  detail: 'brief',
  includeContent: false,
  lookbackDays: 1,
  upcomingDays: 7,
  sections: ['activity', 'due', 'savedViews'],
};

export const HOME_UPDATE_SETTINGS: UpdateSettings = {
  ...DEFAULT_UPDATE_SETTINGS,
  name: 'Workspace brief',
  time: '08:00',
  lookbackDays: 3,
  sections: ['activity', 'due', 'calendar'],
};

export interface UpdateSchedule {
  key: string;
  settings: UpdateSettings;
  revision: string;
  inherited: boolean;
}

export const UPDATE_CHANNEL_LABELS = {
  email: 'Email',
  slack: 'Slack DM',
  telegram: 'Telegram DM',
} as const;

export type DeliveredUpdateChannel = keyof typeof UPDATE_CHANNEL_LABELS;
