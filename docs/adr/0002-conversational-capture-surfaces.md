# Conversational capture surfaces are first-party timeline inputs

Slack and Telegram are first-party conversational capture surfaces, not passive
third-party integrations. Slack should use first-party tables and
`raw_events.source='slack'` while reusing shared token encryption, queues, and
document/audio processing primitives; Telegram should be brought into the same
shared conversational rules where it has drifted.

Conversational messages preserve sender context separately from source ownership,
and that context must feed retrieval and extraction rather than only timeline
display. Direct-message captures may receive lightweight acknowledgements, but
group chats and channels should not. Edits preserve immutable raw rows while
tombstoning superseded revisions; source deletions tombstone active timeline
rows when the platform reports them. Attachments split by type: audio becomes
transcribed raw events, while supported text, image, PDF, and document files
become document-drive versions linked to the source message under explicit size,
type, and count guardrails.
