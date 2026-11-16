import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const retrieveWorkspaceContextInput = z.object({
  ranking: z.enum(['auto', 'relevance', 'balanced']).optional(),
  query: z.string().trim().min(1).max(500),
  recipe: z
    .enum([
      'auto',
      'object_profile',
      'timeline_evidence',
      'task_status',
      'calendar',
      'board_state',
      'document_knowledge',
      'product_guide',
    ])
    .optional(),
  objectId: z.string().regex(UUID_RE).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeDocuments: z.boolean().optional(),
  includeCalendar: z.boolean().optional(),
});

export type RetrieveWorkspaceContextInput = z.infer<typeof retrieveWorkspaceContextInput>;
export type RetrievalRecipe = NonNullable<RetrieveWorkspaceContextInput['recipe']>;

/** Trusted invocation state, separate from model-controlled retrieval arguments. */
export interface RetrievalExecutionContext {
  currentDate?: Date | undefined;
}
