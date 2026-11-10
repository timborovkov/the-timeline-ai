# Captured Files and Documents

## Purpose

The Timeline needs to understand files without turning every conversational
attachment into a durable document-drive item. Captured files are source-backed
evidence; documents are curated workspace knowledge.

## Decisions

- Captured files and documents share the existing file/version/blob/chunk
  storage path, but rows must distinguish unpromoted captured files from
  curated documents.
- Captured files inherit source-event visibility and must not widen
  automatically. Promotion may preserve or narrow visibility by default;
  widening visibility is explicit and audited.
- The default document drive shows folders and curated documents, not
  unpromoted captured files. Captured files can appear in a dedicated triage
  view, source-event detail, search results, and agent citations.
- Folders belong to promoted documents. Unpromoted captured files are organized
  by source evidence and the current Captured inbox filters: source, date, file
  type, and processing status. Sender filters, bulk triage, and promotion-state
  filters remain follow-ups.
- Promotion is identity-preserving: the original captured file becomes visible
  and manageable as a document without copying its blob or losing its source
  evidence link. The original capture can become version 1; later uploads can
  extend the document's version history. Source capture time remains
  provenance; document-drive activity uses promotion, version, and document
  update times.
- Unpromoted captured files only surface provenance for source events that are
  still visible and active. Promoted documents can remain active after source
  evidence is tombstoned, while preserving the stored source metadata as
  provenance.
- Extracted representations are typed. Source text, transcript text, visual
  description, and metadata preview are distinct queryable representations, so
  generated descriptions are not quoted as literal source text.
- Suggested titles for captured or generated filenames are UI metadata stored
  on `documents.metadata.suggested_title`. They are not canonical source
  filenames and must not overwrite `documents.name` unless a user explicitly
  renames or promotes with that title.
- Visual files need both faithful text extraction when available and semantic
  visual description when useful. Current processing extracts PDF/DOCX bytes in
  ephemeral Daytona sandboxes via Firecrawl anydoc (office + text PDFs;
  per-page coverage sends sparse, scanned, and mixed PDFs through bounded page
  PNG rendering), sends those page images and `image/*` uploads through vision OCR in the
  credential-thin document-extract orchestrator
  (with optional visual description), and defers only oversized captured files;
  future processing can tune depth by intent so lightweight
  previews are enough until promotion, targeted inspection, or explicit user
  intent warrants deeper analysis. Persisted visual descriptions should be
  neutral observations about what is visible; business interpretation belongs in
  answers or suggestions. See [ADR 0013](adr/0013-daytona-document-extract.md).
- Budget deferral is normal product state, not processing failure. Deferred
  files keep lightweight metadata or preview context so they remain findable.
- Voice memos are timeline evidence. Native voice-message surfaces from
  Telegram and Slack are transcribed by default, and large stored audio is split
  into provider-sized chunks before transcription. Manual document uploads do
  not currently transcribe audio through document extraction; ambiguous shared
  audio can defer deeper processing.
- Timeline-oriented agent questions include source-evidence representations by
  default. Curated documents are reference knowledge and are searched when the
  question calls for document context.
- Extraction enriches source evidence. It does not create separate timeline
  activity unless a person takes an explicit workspace action such as promotion,
  deletion, or visibility change.
- Timeline source evidence shows compact attachment and preview signals today,
  including inline previews for viewable captured images, PDFs, and audio.
  Richer transcript/OCR/visual-description indicators remain follow-up UI work;
  full extracted representations belong in event detail, citations, and agent
  tools.
- Representation corrections are planned as layered, audited user edits over
  model output. They should not mutate the source file or require the workspace
  approval queue.
- Agents should have a targeted file-inspection tool for asking narrow
  questions about a known captured file or document version. Precomputed
  representations support recall; targeted inspection supports precision.
  Inspection returns an immediate answer and may persist a reusable extracted
  representation when the result should improve future search or agent use.
  Persisted inspection output must be representation-like, not arbitrary
  conclusions or workspace interpretation.

## Capture and promotion

- Telegram and Slack file attachments now create unpromoted captured files that
  inherit the parent raw event's visibility and source provenance.
- Manual uploads remain curated document-drive items and keep the existing
  folder/version behavior.
- Home capture attachments route audio files through the timeline audio
  transcription path, while images and document-like files use the curated
  document upload path.
- Extracted representations are typed as source text, transcript text, visual
  description, or metadata preview.
- Oversized unpromoted captured files can be marked deferred with a lightweight
  metadata preview instead of failed.
- The document drive defaults to curated documents and folders, with a captured
  files triage surface for source evidence and promotion.
- The Documents product surface is now two related workspaces: the default
  knowledge library for curated uploads, and the Captured inbox for Telegram,
  Slack, and other event-backed attachments. Captured rows show suggested
  titles, source/type/status/date filters, preview affordances, event links,
  and an explicit promotion flow.
- Generated provider filenames are visually middle-truncated wherever the raw
  stored name is shown, while the full filename remains preserved for hover
  detail, storage, provenance, and extraction routing.
- Timeline-oriented retrieval includes captured-file evidence, while document
  search remains scoped to curated documents. The operating-memory engine
  treats curated documents as **reference knowledge** (Ask, object summaries,
  proposal context) and treats unlabeled Drive file-change pings plus "Uploaded X"
  lifecycle rows as pulses. Native Drive v1 judged captures are communication
  events (compact hunks, never a document-drive copy). See
  [relational-memory.md](./relational-memory.md).
