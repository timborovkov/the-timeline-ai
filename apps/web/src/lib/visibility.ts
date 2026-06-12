import { z } from 'zod';

const VISIBILITY_VALUES = ['team', 'private', 'specific_users'] as const;

export const visibilitySchema = z.enum(VISIBILITY_VALUES);

export type Visibility = z.infer<typeof visibilitySchema>;
