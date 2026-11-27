import { EVENT_VISIBILITIES } from '@timeline/db/contracts/workspace-access';
import { z } from 'zod';

export const visibilitySchema = z.enum(EVENT_VISIBILITIES);

export type Visibility = z.infer<typeof visibilitySchema>;
