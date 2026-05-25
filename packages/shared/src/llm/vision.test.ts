import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../env.js';

import { extractTextFromMedia, resolveVisionModelId } from './vision.js';

import type { LanguageModel } from 'ai';

// The v3 model layer in `ai` doesn't re-export its call-options type from
// the package root. We only need the prompt + maxOutputTokens fields for
// our assertions, so type the captured call narrowly.
interface MockCallOptions {
  prompt: { role: string; content: unknown }[];
  maxOutputTokens?: number;
}

const ENV_BACKUP = { ...process.env };

interface CapturedCall {
  prompt: MockCallOptions['prompt'];
  maxOutputTokens?: number;
}

function makeCapturingModel(responseText: string): {
  model: LanguageModel;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  // MockLanguageModelV3.doGenerate receives the full call options; we
  // snapshot `prompt` and `maxOutputTokens` so the tests can assert what
  // shape extractTextFromMedia handed the SDK. Casting to `never` on the
  // implementation matches the chat.test.ts pattern.
  const model = new MockLanguageModelV3({
    doGenerate: ((options: MockCallOptions) => {
      calls.push({
        prompt: options.prompt,
        ...(options.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: options.maxOutputTokens }),
      });
      return Promise.resolve({
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        content: [{ type: 'text', text: responseText }],
        warnings: [],
      });
    }) as never,
  });
  return { model, calls };
}

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    OPENROUTER_API_KEY: 'sk-test-key',
    OPENROUTER_BASE_URL: 'https://example.test/v1',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('extractTextFromMedia', () => {
  it('sends an image content part for image/* media types', async () => {
    const { model, calls } = makeCapturingModel('alt text from screenshot');
    const result = await extractTextFromMedia(
      {
        body: Buffer.from([0xff, 0xd8, 0xff]), // JPEG magic bytes
        mediaType: 'image/jpeg',
      },
      { model },
    );
    expect(result.text).toBe('alt text from screenshot');
    expect(calls).toHaveLength(1);
    // ai-sdk normalises image parts into `type: 'file'` with the image
    // mediaType by the time they reach the v3 model layer — both Image
    // and File parts ride the same "file" wire shape. Verify by mediaType
    // rather than by part type discriminator.
    const userMsg = calls[0]!.prompt.find((m: { role: string }) => m.role === 'user');
    expect(userMsg).toBeDefined();
    const parts = userMsg!.content as { type: string; mediaType?: string }[];
    expect(Array.isArray(parts)).toBe(true);
    const imageLike = parts.find((p) => p.mediaType === 'image/jpeg');
    expect(imageLike).toBeDefined();
  });

  it('sends a file content part for application/pdf', async () => {
    // Vision-capable models read PDFs natively as file parts. Image-only
    // models would silently degrade; the mediaType on the file part is
    // the routing signal the model uses.
    const { model, calls } = makeCapturingModel('# Contract\n\nParties: ...');
    const pdfBytes = Buffer.from('%PDF-1.4\n', 'utf-8');
    const result = await extractTextFromMedia(
      { body: pdfBytes, mediaType: 'application/pdf', filename: 'lease.pdf' },
      { model },
    );
    expect(result.text).toContain('Contract');
    const parts = calls[0]!.prompt.find((m: { role: string }) => m.role === 'user')!.content;
    const filePart = (parts as { type: string }[]).find((p) => p.type === 'file');
    expect(filePart).toMatchObject({
      type: 'file',
      mediaType: 'application/pdf',
      filename: 'lease.pdf',
    });
  });

  it('refuses non-image / non-PDF media types so callers route them elsewhere', async () => {
    const { model } = makeCapturingModel('unused');
    await expect(
      extractTextFromMedia(
        {
          body: Buffer.from('PK'),
          mediaType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        { model },
      ),
    ).rejects.toThrow(/unsupported mediaType/);
    // The DOCX path must use a native extractor (mammoth) not the vision
    // LLM — vision-on-Office-XML costs more and produces lossier output.
  });

  it('caps maxOutputTokens to bound cost (default 8000, overridable)', async () => {
    const { model, calls } = makeCapturingModel('ok');
    await extractTextFromMedia(
      { body: Buffer.from([0xff, 0xd8]), mediaType: 'image/jpeg' },
      { model },
    );
    expect(calls[0]!.maxOutputTokens).toBe(8000);

    const { model: model2, calls: calls2 } = makeCapturingModel('ok');
    await extractTextFromMedia(
      {
        body: Buffer.from([0xff, 0xd8]),
        mediaType: 'image/jpeg',
        maxOutputTokens: 500,
      },
      { model: model2 },
    );
    expect(calls2[0]!.maxOutputTokens).toBe(500);
  });

  it('attaches an OCR system prompt so output is plain transcription (no commentary)', async () => {
    const { model, calls } = makeCapturingModel('ok');
    await extractTextFromMedia(
      { body: Buffer.from([0xff, 0xd8]), mediaType: 'image/png' },
      { model },
    );
    const systemMsg = calls[0]!.prompt.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    // System prompt must forbid commentary so chunks don't get garbage
    // preamble ("Here is the text:") that contaminates retrieval. The
    // v3 prompt normalises system content to either a string or an
    // array of text parts depending on the SDK version — handle both.
    const sysContent = systemMsg!.content;
    const text =
      typeof sysContent === 'string'
        ? sysContent
        : (sysContent as { text?: string }[])
            .map((c) => c.text ?? '')
            .join('\n');
    expect(text).toMatch(/no commentary|no preamble|transcribe faithfully/i);
  });

  it('resolveVisionModelId honors VISION_MODEL env override', () => {
    expect(resolveVisionModelId()).toBe('openai/gpt-4o-mini');
    process.env = { ...process.env, VISION_MODEL: 'anthropic/claude-3-5-sonnet' };
    resetEnvForTests();
    expect(resolveVisionModelId()).toBe('anthropic/claude-3-5-sonnet');
  });
});
