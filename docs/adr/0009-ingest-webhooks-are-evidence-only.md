# Ingest webhooks are evidence-only

Generic ingest webhooks accept arbitrary external payloads as raw source
evidence, but they do not directly update canonical workspace state. We chose
this over treating named webhooks like native integrations because webhook
payloads have no trusted provider schema or stable ownership model; they can
still support search, answers, and approval-backed proposals, while only native
integrations may become authoritative sources.

Admins choose a Timeline type (`communication`, `work_record`, `pulse`,
`incident`, `artifact`, or `schedule`) when creating the webhook. That class is
presentation-only: it stamps `source_metadata.event_class`, chooses visual
weight, and never promotes `objectMap` into workspace object identity. Unknown
or unset types default to pulse. ADR 0009 still holds even when the webhook is
typed as a work record.
