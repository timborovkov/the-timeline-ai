import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { type FilePart, type ImagePart, type LanguageModel } from 'ai';

import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { generateText, withLangSmithProviderOptions } from '#src/llm/tracing.js';

/**
 * Vision-based text extraction. One inference layer for OCR/transcription of
 * non-text documents: images, PDFs, and any future media type a vision model
 * accepts natively.
 *
 * Routes through the same OpenRouter provider as `llm.chat` so model
 * selection, billing, and rate limits stay unified. The model id is pinned in
 * `TIMELINE_MODELS` because extraction quality + token cost depend sharply on
 * the model; cutovers should be deliberate and re-runnable via
 * `redocument-extract --force`.
 *
 * Cost notes:
 *   - Vision tokens are 5-10x text tokens on most providers. A 10-page PDF
 *     can run $0.05-$0.20 depending on resolution and model.
 *   - The 25 MiB document cap upstream is the only structural ceiling
 *     today. Per-team monthly cost tracking is Phase 12.
 */

export interface ExtractTextFromMediaInput {
  /** Raw bytes of the document. */
  body: Buffer;
  /** MIME type — drives whether we send an image part or a file part. */
  mediaType: string;
  /** Optional filename hint surfaced to the model. Improves OCR on scans
   *  where the name carries domain context (e.g. "lease.pdf"). */
  filename?: string;
  /** Override the configured vision model for this call. */
  model?: string;
  /** Hard cap on output tokens to bound cost and runtime. Defaults to
   *  8000 tokens (~6000 words), enough for ~10 pages of dense text. */
  maxOutputTokens?: number;
}

export interface ExtractTextFromMediaResult {
  text: string;
  model: string;
}

export interface VisionDeps {
  /** Inject a pre-built LanguageModel — used by tests. */
  model?: LanguageModel;
}

function resolveVisionModelId(): string {
  return TIMELINE_MODELS.vision.id;
}

function buildDefaultModel(modelId: string): LanguageModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for llm.extractTextFromMedia');
  }
  const baseURL = env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
  });
  return provider(modelId);
}

const SYSTEM_PROMPT = `You are an OCR + document transcription engine. Output the document's text as plain text, preserving:
- paragraph breaks (one blank line between paragraphs)
- list structure (use "- " for bullets, "1. " for numbered lists)
- table structure (use plain pipe-delimited rows, header underline with dashes)
- headings (prefix with "# " for major sections, "## " for sub-sections)

Rules:
- Output ONLY the transcribed text. No commentary, no preamble, no "Here is the text:".
- If a page contains an image with no text, write [image] on its own line.
- If text is illegible, write [illegible] inline.
- If the document is multiple pages, separate pages with two blank lines.
- Do not summarise. Do not paraphrase. Transcribe faithfully.`;

/**
 * Send a binary document (PDF, image) to a vision model and get back its
 * text content. Use for documents whose body is not directly readable as
 * UTF-8 (PDFs, scans, photos, screenshots).
 *
 * For DOCX / pptx / other Office formats, prefer a native extractor
 * (`mammoth`, `unzipper` + xml parse) — vision is more expensive and
 * lossier than the native XML.
 */
export async function extractTextFromMedia(
  input: ExtractTextFromMediaInput,
  deps: VisionDeps = {},
): Promise<ExtractTextFromMediaResult> {
  const modelId = input.model ?? resolveVisionModelId();
  const model = deps.model ?? buildDefaultModel(modelId);

  const mediaType = input.mediaType.toLowerCase();
  const isImage = mediaType.startsWith('image/');
  const isPdf = mediaType === 'application/pdf';
  if (!isImage && !isPdf) {
    throw new Error(
      `extractTextFromMedia: unsupported mediaType "${input.mediaType}" (images and PDFs only)`,
    );
  }

  // ai-sdk discriminates image vs file content parts. Images go through
  // the vision endpoint; PDFs are file attachments that vision-capable
  // models (Claude 3.5+, GPT-4o, Gemini 1.5+) read natively.
  const contentPart: ImagePart | FilePart = isImage
    ? { type: 'image', image: input.body, mediaType }
    : {
        type: 'file',
        data: input.body,
        mediaType: 'application/pdf',
        ...(input.filename ? { filename: input.filename } : {}),
      };

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          contentPart,
          {
            type: 'text',
            text: 'Transcribe the attached document to plain text. Follow the formatting rules in the system prompt.',
          },
        ],
      },
    ],
    maxOutputTokens: input.maxOutputTokens ?? 8000,
    providerOptions: withLangSmithProviderOptions(undefined, {
      name: 'llm.extractTextFromMedia',
      model: modelId,
      metadata: {
        operation: 'extract_text_from_media',
        media_type: mediaType,
        input_bytes: input.body.byteLength,
        has_filename: input.filename ? true : false,
        max_output_tokens: input.maxOutputTokens ?? 8000,
      },
    }),
  });

  return { text: result.text, model: modelId };
}

export { resolveVisionModelId };
