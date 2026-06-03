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
Private or specific-user conversational raw events do not schedule
team-visible conversation reviews; they are skipped before the proposal LLM
boundary. Review scheduling is debounced per conversation key and only advances
to newer raw events, so duplicate or delayed source jobs cannot move the review
anchor backward.
For Slack, thread reviews use the Slack thread timestamp as the conversation
key, include the root message as evidence even when the original root event was
captured before Slack supplied thread metadata, and keep unthreaded channel
reviews from absorbing replies from unrelated threads. When a reply arrives for
an initially unthreaded root, the pending unthreaded channel review for that
Slack channel is superseded by the thread review, even if the channel review
anchor has already advanced to a later unthreaded message.

The first implementation should prioritize proposal quality over retrieval
enrichment, while keeping the evidence-window helper reusable by retrieval.
Conversation Reviews may successfully produce no action, and they should not
create canonical conversation summaries in v1. General fact extraction remains
event-anchored; Conversation Reviews drive proposal decisions. Cross-source
context requires explicit or object-backed relationship signals rather than
semantic similarity, same sender, or nearby time alone.
