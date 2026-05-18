# OpenRouter setup

> Used from **Phase 3** (transcription) and onwards.

OpenRouter is a single provider for chat, embeddings, and transcription. The
internal LLM wrapper (`packages/shared/llm`) talks to it via the OpenAI SDK
shape.

## 1. Account + API key

1. Sign up at <https://openrouter.ai>.
2. Add credits (test with $5).
3. Create an API key (Settings → Keys).

Set in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

## 2. Model pins

The embedding model is pinned. Changing it invalidates the entire vector
index — re-embed before changing.

```bash
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
TRANSCRIPTION_MODEL=openai/whisper-1
CHAT_MODEL_DEFAULT=anthropic/claude-3.7-sonnet
```

## 3. Quick smoke test

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

## Re-embed procedure (when changing `EMBEDDING_MODEL`)

1. Update `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in env.
2. Create a new Qdrant collection at the new size.
3. Run `pnpm --filter @timeline/worker reembed -- --collection=<new>`.
4. Cut over read path to the new collection.
5. Drop the old collection.

This procedure is the only safe path. Never edit embeddings in place.
