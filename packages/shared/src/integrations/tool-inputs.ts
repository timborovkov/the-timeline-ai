import { NATIVE_PROVIDER_IDS } from '@timeline/db/integration-providers';
import { z } from 'zod';

export const nativeProviderSchema = z.enum(NATIVE_PROVIDER_IDS);

export const searchIntegrationEventsInput = z.object({
  query: z.string().trim().min(1).max(500),
  provider: nativeProviderSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export const getIntegrationResourceInput = z.object({
  provider: nativeProviderSchema,
  externalObjectId: z.string().min(1).max(512),
  historyLimit: z.number().int().min(1).max(50).optional(),
});
