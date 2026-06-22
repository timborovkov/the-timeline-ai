# Ingest webhooks are evidence-only

Generic ingest webhooks accept arbitrary external payloads as raw source
evidence, but they do not directly update canonical workspace state. We chose
this over treating named webhooks like native integrations because webhook
payloads have no trusted provider schema or stable ownership model; they can
still support search, answers, and approval-backed proposals, while only native
integrations may become authoritative sources.
