# Captured Files and Documents

## Purpose

The Timeline needs to understand files without turning every conversational
attachment into a durable document-drive item. Captured files are source-backed
evidence; documents are curated workspace knowledge.

## Decisions

- Captured files and documents share the existing file/version/blob/chunk
  storage path, but rows must distinguish unpromoted captured files from
  curated documents.
- The schema can be reshaped directly. The product is not preserving legacy
  compatibility for the old model where every captured file is a document.
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
  visual description when useful. Current processing fully extracts normal
  image/PDF captures and defers only oversized captured files; future processing
  can tune depth by intent so lightweight previews are enough until promotion,
  targeted inspection, or explicit user intent warrants deeper analysis.
  Persisted visual descriptions should be neutral observations about what is
  visible; business interpretation belongs in answers or suggestions.
- Budget deferral is normal product state, not processing failure. Deferred
  files keep lightweight metadata or preview context so they remain findable.
- Voice memos are timeline evidence. Native voice-message surfaces from
  Telegram and Slack are transcribed by default. Manual document uploads do not
  currently transcribe audio through document extraction; ambiguous shared audio
  can defer deeper processing.
- Timeline-oriented agent questions include source-evidence representations by
  default. Curated documents are reference knowledge and are searched when the
  question calls for document context.
- Extraction enriches source evidence. It does not create separate timeline
  activity unless a person takes an explicit workspace action such as promotion,
  deletion, or visibility change.
- Timeline lists show compact attachment and preview signals today. Richer
  transcript/OCR/visual-description indicators remain follow-up UI work; full
  extracted representations belong in event detail, citations, and agent tools.
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

## Implemented First Pass

- Telegram and Slack file attachments now create unpromoted captured files that
  inherit the parent raw event's visibility and source provenance.
- Manual uploads remain curated document-drive items and keep the existing
  folder/version behavior.
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
- Timeline-oriented retrieval includes captured-file evidence, while document
  search remains scoped to curated documents.

## Remaining Follow-Ups

- Agent tools can search and fetch precomputed document chunks, but cannot yet
  run a targeted second-pass vision inspection on a specific original file.
- Representation corrections are still planned as layered, audited edits over
  model output.
- Captured-file triage can grow sender filters, bulk actions, and deeper
  targeted inspection beyond the current source/date/type/status filters and
  promotion path.

## Implementation Shape

Implement this as one coherent feature branch with phased reviewable slices:
schema/domain first, ingestion and processing next, document-drive UI and
promotion next, and agent tooling after the storage and representation model is
stable.

## First-Pass Done Criteria

- Schema distinguishes captured files from documents and supports promotion
  metadata plus typed extracted representations.
- Telegram, Slack, and manual upload ingestion create the right file kind and
  inherit source visibility where applicable.
- Voice memos, images, PDFs, and text-ish files produce searchable
  representations, using budget deferral where appropriate.
- The document drive defaults to curated documents and folders only, with
  captured files available through a separate triage/source-evidence surface.
- Display titles use a stable precedence everywhere: human `documents.name`,
  then `metadata.suggested_title` for generated names, then a generic
  attachment fallback such as "Image attachment" or "PDF attachment".
- Agent retrieval includes source-evidence representations for timeline
  questions and curated documents for document/reference questions.
- Existing "everything is a document" assumptions are removed rather than kept
  as legacy compatibility.
- Targeted file inspection and representation corrections can follow in a later
  implementation pass, but the schema should leave room for them.
