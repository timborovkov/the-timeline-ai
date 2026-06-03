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

const legacyExtractedFactSchema = z
  .object({
    text: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
    entities: z.array(entityMentionSchema).max(20),
  })
  .transform((fact) => ({
    statement: fact.text,
    confidence: fact.confidence,
    mentions: fact.entities,
  }));

export const extractionResultSchema = z.object({
  facts: z.array(extractedFactSchema).max(20),
});

const legacyExtractionResultSchema = z.object({
  facts: z.array(legacyExtractedFactSchema).max(20),
});

export type EntityMention = z.infer<typeof entityMentionSchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export function normalizeExtractionResult(input: unknown): ExtractionResult {
  const canonical = extractionResultSchema.safeParse(input);
  if (canonical.success) return canonical.data;
  return legacyExtractionResultSchema.parse(input);
}
