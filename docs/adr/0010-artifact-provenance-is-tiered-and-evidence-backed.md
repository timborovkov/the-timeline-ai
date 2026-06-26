# Artifact provenance is tiered and evidence-backed

Derived workspace artifacts need provenance that explains why they exist,
belong on a board, or changed; a single `source_event_id` cannot represent
conversation windows, attachments, links, later clarifying evidence, or
board-local rationale. We keep accepted suggestion bundles and their evidence
as durable artifact provenance, layer observed evidence associations separately,
and show provenance in trust tiers: why the artifact exists, what changed it,
and related observed evidence.

Board-local provenance is distinct from object-level provenance. The same raw
event can support multiple objects, board memberships, or board item updates,
but each association must carry its own artifact- or board-specific rationale
instead of reusing a generic copied receipt.
