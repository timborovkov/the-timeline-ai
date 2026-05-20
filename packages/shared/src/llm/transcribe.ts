import { getEnv } from '../env';

export interface TranscribeInput {
  audio: Buffer;
  filename: string;
  mimeType: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

export interface TranscribeDeps {
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * POST audio to OpenRouter's OpenAI-compatible `/audio/transcriptions`
 * endpoint and return the transcript text. Model is pinned via env
 * (`TRANSCRIPTION_MODEL`); the result includes the model name so callers
 * can persist it for future re-transcription audits.
 */
export async function transcribeAudio(
  input: TranscribeInput,
  deps: TranscribeDeps = {},
): Promise<TranscribeResult> {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for transcription');
  }
  const model = env.TRANSCRIPTION_MODEL ?? 'openai/whisper-1';
  const baseUrl = env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const fetchImpl = deps.fetch ?? fetch;

  const form = new FormData();
  form.append('file', new Blob([input.audio], { type: input.mimeType }), input.filename);
  form.append('model', model);

  const res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter transcription failed: ${res.status} ${errBody}`);
  }
  const json = (await res.json()) as { text?: string };
  if (typeof json.text !== 'string') {
    throw new Error('OpenRouter transcription response missing `text`');
  }
  return { text: json.text, model };
}
