# Visibility owners, not admins, control private item visibility

Team owners and admins can manage team settings and shared operational
workflows, but they do not bypass private or restricted item visibility. Phase
13 introduces the visibility owner as the person allowed to change an item's
audience, because shared capture surfaces can separate attribution from control:
a group chat, forwarded email, meeting, or integration may not map cleanly to a
single author. This preserves trust in per-item privacy while still letting
admins configure future defaults and team-owned surfaces.

Source-specific visibility defaults only affect future captures/imports. They
do not rewrite existing raw events, documents, meetings, calendar events, or
integration events. Expanding or narrowing an existing event's audience is a
one-off edit by that event's visibility owner, and every such edit is recorded
in the append-only trust audit log.
