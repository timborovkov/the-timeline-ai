import { z } from 'zod';

export const entityTypeSchema = z.enum(['person', 'company', 'project', 'topic', 'other']);
export type ExtractedEntityType = z.infer<typeof entityTypeSchema>;

export const factRoleSchema = z.enum(['subject', 'object', 'topic']);
export type ExtractedFactRole = z.infer<typeof factRoleSchema>;

export const entityMentionSchema = z.object({
  name: z.string().min(1).max(200),
  type: entityTypeSchema,
  role: factRoleSchema,
  aliases: z.array(z.string().min(1).max(200)).max(10).optional(),
});

export const extractedFactSchema = z.object({
  statement: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  mentions: z.array(entityMentionSchema).max(20),
});

export const extractionResultSchema = z.object({
  facts: z.array(extractedFactSchema).max(20),
});

export type EntityMention = z.infer<typeof entityMentionSchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
