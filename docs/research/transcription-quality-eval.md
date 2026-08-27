# Multilingual transcription quality evaluation

Status: opt-in engineering evaluation. This command does not change the
production transcription model or process Recall.ai meeting audio.

Timeline treats Recall meeting transcription and OpenRouter voice-note
transcription as separate pipelines. This evaluator covers only the latter: web
voice notes and audio captured through Telegram, Slack, and email.

## Safety boundary

Never run this evaluation with customer data. The corpus manifest must declare
one of these origins:

- purpose-built synthetic recordings;
- recordings whose license permits external model evaluation; or
- non-customer recordings with explicit approval for this evaluation.

The manifest must also set `containsCustomerData` to `false` and
`approvedForExternalModelEvaluation` to `true`. Validation finishes and every
audio file is buffered before the first paid request. Audio stays outside the
repository and every path must remain below the manifest directory after
filesystem real-path resolution. A fixture symlink that resolves outside that
approved corpus root is rejected before any audio is read or sent.

The evidence artifact contains only:

- SHA-256 fingerprints for the manifest and ordered audio corpus;
- aggregate corpus coverage;
- model IDs, current public ZDR endpoint counts, provider-set hashes, and
  ZDR-tag-set hashes;
- full endpoint-inventory status plus matched-ZDR, non-ZDR, and total endpoint
  counts and an inventory-tag-set hash;
- aggregate quality, error, latency, availability, cost, and route metrics;
- aggregate actual-route verification counts for missing, matched-ZDR, and
  non-ZDR provider metadata;
- the parsed non-secret operator-attestation fields bound to the policy,
  model-catalog digest, inference-key fingerprint, and guardrail id;
- language and capture-source aggregate slices; and
- gate results and the eligible-model ranking.

It never contains audio, base64, file paths, case IDs, references, hypotheses,
provider error bodies, or generation IDs. The command uses OpenRouter's ordinary
generation-metadata endpoint only to aggregate the actual upstream provider,
data region, and fallback cost. It never requests the generation-content
endpoint. Neither the inference key nor the attestation token is written to the
report. The output file is created with owner-only permissions and refuses to
overwrite an existing artifact.

## Corpus contract

The JSON manifest uses `transcription-quality-corpus-v1` and requires at least
24 distinct BCP-47 language tags across at least eight distinct language
families. Every case names its language family, declared
format, product capture source, source metadata, scenarios, and reference text.
Name and number cases also enumerate the exact expected entities or numbers used
for their accuracy score.

A valid corpus covers every current production input format:

`wav`, `mp3`, `flac`, `m4a`, `ogg`, `webm`, and `aac`.

It also covers every product capture source:

`web_voice_note`, `telegram_voice`, `slack_audio`, and `email_audio`.

The required stress scenarios are `accent`, `background_noise`, `silence`,
`names`, `numbers`, `long_low_bitrate`, and `code_switching`. A silence case has
an empty reference. All other cases have a non-empty reference.

This is a single-case shape illustration, not a complete valid corpus:

```json
{
  "schemaVersion": "transcription-quality-corpus-v1",
  "corpusId": "approved-multilingual-v1",
  "fixturePolicy": {
    "origin": "licensed",
    "containsCustomerData": false,
    "approvedForExternalModelEvaluation": true,
    "licenseOrApprovalReference": "internal-license-record-123"
  },
  "cases": [
    {
      "id": "fi-office-01",
      "audioPath": "audio/fi-office-01.m4a",
      "format": "m4a",
      "language": "fi",
      "languageFamily": "Uralic",
      "referenceText": "The licensed reference transcript stays in this local manifest.",
      "source": "web_voice_note",
      "sourceMetadata": {
        "durationMs": 12750,
        "sampleRateHz": 48000,
        "channels": 1,
        "bitrateKbps": 48,
        "codec": "AAC-LC",
        "container": "M4A",
        "accent": "regional",
        "noiseClass": "office",
        "captureDeviceClass": "mobile"
      },
      "scenarios": ["accent", "background_noise"]
    }
  ]
}
```

## Running the bake-off

Keep the API key and manifest outside source control. The ignored environment
file must contain `OPENROUTER_API_KEY`, `OPENROUTER_GUARDRAIL_ID`, and the
current generated `OPENROUTER_PRIVACY_POLICY_ATTESTATION`. Generate that
non-secret `orpa1` token with `pnpm openrouter:attestation --
--env-file=/secure/operator.env`, then point the eval to the complete file:

```bash
TRANSCRIPTION_QUALITY_EVAL_ENV_FILE=/secure/eval.env \
pnpm eval:transcription-quality:live -- \
  --manifest=/secure/corpus/manifest.json \
  --out=/secure/evidence/transcription-eval-2026-08-21T1000Z.json \
  --baseline=openai/gpt-4o-transcribe \
  --candidate=openai/whisper-large-v3 \
  --candidate=google/chirp-3 \
  --candidate=mistralai/voxtral-mini-transcribe \
  --request-budget-ms=120000 \
  --concurrency=2
```

Candidates are explicit because OpenRouter's model catalog and endpoints can
change. The command checks the live public ZDR registry before sending audio and
does not evaluate a candidate with zero listed ZDR endpoints. Registry presence
alone is not promotion evidence. Before any candidate audio upload, the command
also fetches `GET /api/v1/models/{author}/{slug}/endpoints` with the evaluation
key. It treats every endpoint returned by that available-endpoints inventory as
eligible and requires each endpoint's exact `(model_id, tag)` pair to exist in
the public ZDR registry snapshot. A regular and ZDR sibling from the same
provider therefore fails isolation even though both generation records could
report the same `provider_name`. Missing, inaccessible, empty, or malformed
inventory also fails closed, and the candidate is not evaluated.

For every successful candidate transcription that remains safely evaluable,
the evaluator additionally reads generation metadata and requires the actual
provider name to match that model's current ZDR provider set. Missing provider
metadata or a provider outside that set fails the `actual_zdr_routes` gate. The
provider-name check is secondary evidence rather than endpoint isolation because
provider names do not distinguish regular and ZDR tags. These are
provider-reported route observations, not cryptographic proof.

The generated attestation must match the exact inference key, guardrail id,
code-owned model-catalog digest, and privacy-policy version before the corpus is
loaded or any live request can run. Its parsed fields are operator evidence of
the intended configuration, not proof of provider-side key assignment or
guardrail settings. Preserve the separate management-key check and dated
deployment evidence described in the OpenRouter setup guide.

The command exits non-zero by default when no candidate passes. The optional
`--require-passing-candidate` flag makes that promotion intent explicit but does
not change the default. Use `--allow-no-passing-candidate` only for an
exploratory run where a no-passing artifact is expected; that artifact still
recommends no model change.

The CLI derives its baseline from the code-owned production model registry and
rejects an override that differs from `TIMELINE_MODELS.transcription.id`. Pass
the exact current value with `--baseline` in a locked evidence run if the
invocation itself must state the pin; the artifact always records it.

## Metrics and gates

Provider calls intentionally omit the manifest language and exercise automatic
language detection, matching the production voice-note path. The manifest
language is used only for scoring and aggregate slices; the evidence artifact
records `languageHintMode: "auto_detect"`.

Text is normalized with Unicode NFKC, case folding, punctuation/symbol removal,
and whitespace collapse. WER uses `Intl.Segmenter` word boundaries with a
deterministic whitespace fallback. CER excludes normalized whitespace. Both are
macro-averaged per case, so long recordings do not silently dominate.

Entity and number accuracy require each listed expected term to match a complete
normalized token or contiguous token sequence in the hypothesis; substrings of
different words or numbers do not count. Hallucination means non-empty output
for a silence case. Empty output means empty output for a non-silence case.
Likely truncation is measured only on `long_low_bitrate` cases: an output shorter
than 75% of the reference whose own content is at least 85% aligned with the
reference prefix. Request errors and format errors are separate rates.

A candidate is eligible only when every check passes:

- at least one current public ZDR endpoint is listed;
- every available endpoint in the authenticated full inventory has the same
  model and an exact tag present in the ZDR registry; unavailable or malformed
  inventory and mixed regular/ZDR siblings fail closed before candidate audio
  is sent;
- every successful candidate request reports a provider that is in that
  model's live ZDR provider set;
- macro WER and macro CER are each no more than 0.5 percentage points worse
  than the baseline;
- no language or capture-source WER/CER slice is more than 2 points worse;
- entity and number accuracy are each no more than 1 point worse;
- hallucination, empty-output, likely-truncation, request-error, and format-error
  rates do not increase;
- p95 latency is no more than 15% above the baseline; and
- p95 latency remains inside `--request-budget-ms`.

Passing candidates are ranked by combined WER/CER, entity accuracy, number
accuracy, coverage, p95 latency, availability, mean cost, and finally model ID
for deterministic ties. Privacy does not overrule quality: if no current ZDR
candidate clears the complete gate, this report recommends no model change.

OpenRouter documents JSON/base64 transcription, usage cost, and the
`X-Generation-Id` metadata link in its current
[speech-to-text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt),
[transcription API](https://openrouter.ai/docs/api/api-reference/stt/create-transcription),
[ZDR registry](https://openrouter.ai/docs/guides/features/zdr),
[model endpoint inventory](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints),
and [generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-generation).
