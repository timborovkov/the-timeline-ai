# Conversation reviews drive conversational proposals

Conversational capture surfaces should not create tasks, calendar changes, or
object memory proposals from isolated Slack or Telegram messages. Durable
proposals should be based on a Conversation Review: an ongoing review of the
source conversation that builds a bounded Conversation Evidence Window, starts
with same-source context, and admits cross-source linked context only when
there is a strong relationship signal.

This is deliberately more complex than one suggestion job per raw event. The
simpler model is easier to make idempotent, but it misreads short replies,
follow-up corrections, and long-running group discussions. Conversation
Reviews can merge, revise, or supersede pending proposals as new evidence
arrives; accepted object memory remains canonical until a new correction
proposal is accepted. Retrieval can use the same evidence-window concept for
context enrichment, while durable proposals require the stricter evidence
threshold and must cite only events visible to the proposal audience.

The first implementation should prioritize proposal quality over retrieval
enrichment, while keeping the evidence-window helper reusable by retrieval.
Conversation Reviews may successfully produce no action, and they should not
create canonical conversation summaries in v1. General fact extraction remains
event-anchored; Conversation Reviews drive proposal decisions. Cross-source
context requires explicit or object-backed relationship signals rather than
semantic similarity, same sender, or nearby time alone.
