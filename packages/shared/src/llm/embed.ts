export interface EmbedInput {
  text: string;
}

export interface EmbedResult {
  vector: number[];
  model: string;
}

/**
 * Reserved for Phase 5. The shape is fixed here so producers (and any
 * accidental early callers) get a clear failure instead of silently doing
 * the wrong thing.
 */
export function embed(_input: EmbedInput): Promise<EmbedResult> {
  return Promise.reject(new Error('llm.embed is not implemented — lands in Phase 5'));
}
