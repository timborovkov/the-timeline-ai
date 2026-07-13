# Saved meetings own recurring meeting capture

Saved meetings are the reusable capture target for repeated calls: they store the configured meeting link, aliases, optional schedule, visibility, and the creation-time confirmation that the team has permission to capture that meeting. The link remains editable so a recurring meeting can move between rooms or providers without replacing the saved configuration; changing it cancels and regenerates future materialized captures and linked calendar entries while leaving past or active captures unchanged. We chose this over waiting for Google Calendar sync because Timeline calendar events are schedule memory rather than the authoritative source for recurring external calls, and over per-join approval because saved meetings exist specifically to remove daily friction. Scheduled saved meetings materialize upcoming meeting captures and linked calendar entries on a rolling four-week window; completed captures enrich those entries with transcript summary and action items instead of creating duplicates.

**Consequences**

- Quick meeting capture remains separate: raw URL joins require a prompt-specific confirmation button or direct reply unless they resolve to a saved meeting.
- Any team member can create a saved meeting and enable auto-join; team-wide caps, disable switches, audit history, and admin deletion remain the guardrails.
- Aliases are unique among active saved meetings within a team and become reusable when their saved meeting is archived.
- Every bot join path must use a bounded no-show window, with Google Meet using a provider-safe 550-second window.
