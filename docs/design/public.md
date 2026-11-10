# Public-site design patterns

The public landing page is an editorial, six-scene acquisition narrative:
claim, evidence and chronology, cited answer, Slack-to-cited-answer with an MCP
example, audience fit with trust, and a Start free CTA. The claim scene also
includes a compact For agents card: title and body that agents read the work
record and write notes back like teammates, official Claude, ChatGPT, Cursor,
Grok, OpenClaw, and Hermes marks on white tiles in a single row, and the copyable
`Set up The Timeline - https://thetimeline.cc/llms.txt` command. The card follows
landing `--home-*` tokens in both themes and does not use letter discs. The claim defines The Timeline as an auto-updating work record:
what is said in Slack, Telegram, email and calls becomes current client, deal,
task and decision records, with the source for every line. Captured evidence
lands automatically; lasting record changes wait for human approval. Closing
signup entry points (home, product tour, team daily log, and the Free pricing
card) show the first-run path: team created, one capture source, then the first
source-linked record or a question. Audience copy describes how teams work (chat-run teams
on Slack or Telegram, with the rest of the work spread across email, calls and
documents), not team size or role. Updates are daily, with no weekly framing.
The chronology scene names the cost of rebuilding status, promises and decisions
from conversation before showing how selected work becomes an inspectable record.
Its signature example project, Acme rollout, shows five cited work sources
converging into one work record, with a linked Telegram group as the first source.
Captured work settles onto a chronological rail, connects to project, person,
task, and calendar context, and resolves into an answer with tangible source
links. The cited-answer evidence cards keep “Inspect example source” as a native
`<details>` disclosure aligned to the padded titles: a custom chevron beside the
summary, padded expanded text, and the landing lime `:focus-visible` ring around
the summary rather than an unstyled full-width browser outline. Homepage proof screenshots keep the real captures and fictional Acme Labs
labels. Each frame reserves its aspect box, shows a “Loading screenshot” label
until the image paints, and uses always-visible callouts for what changed, who
owns the next step, and the link to the source. Callouts stack on small screens
and do not rely on hover or motion. Suggested
durable workspace changes remain approval-backed; the diagram never implies that
evidence silently rewrites canonical objects. The product-tour approvals step
uses the same narrower promise: lasting record changes wait for approval.
`/pricing` leads with Start Free, no card; the usage estimator is optional
planning, not the first decision. The optional analytics banner sits as a compact
bottom-right card on desktop so proof captions stay readable; Reject and Accept
stay equally prominent, and nothing is sent before a choice. Acme rollout is
the canonical fictional public demo corpus across landing, connector, and guide
examples; every rendered example states that it is illustrative and not
customer data. Provider pages may show distinct slices, but people, identifiers,
records, and outcomes stay coherent across the journey. Connector capability belongs with the
evidence-entry scene; audience fit and the evidence chain remain a separate,
stacked explanation rather than an equal-height split. Substantive copy and
diagrams are server-rendered; a small client motion controller may progressively
reveal below-the-fold scenes, replay evidence flow while it is in view, and show
scroll progress. The hero copy, source cards, central mark, and outcome labels
are complete and in their final positions on first paint; hydration must not
hide or slide them into place. Background motion is prohibited: movement belongs
to the evidence diagram and must explain provenance or hierarchy. The shared public canvas uses
the same subtle fixed grain in both themes, with theme-specific blending so
cream reads like paper and near-black retains its tactile texture.

The landing hero keeps the observatory composition: six compact source cards sit
around a square grid and stream packets along visible curved paths into the
official Timeline mark. The centered diamond is labelled **The Timeline** and
**Work record**; one quiet rail then resolves into **Daily update** and
**Cited answers**. It does not reproduce the expanded timeline, record cards, or
assistant exchange. Every moving packet reuses the exact path drawn behind it,
the animation restarts only when the diagram enters view, and reduced motion
hides the packets while preserving the complete static explanation. Mobile
retains the same topology and removes secondary metadata so cards and labels do
not overlap.

The landing page moves directly from the compact observatory into its chronology,
connector, cited-answer, and trust scenes. The complete four-stage product loop
lives on `/how-it-works`, where it has enough room to explain the platform without
turning the home page into a second hero. The reusable expanded diagram groups
inputs into conversations, meetings and documents, and delivery and incidents;
keeps five representative source-linked events; shows four useful record types;
and closes with one compact assistant exchange across Web, Slack, Telegram, and
an own MCP agent. Permitted live CRM context, approval-backed Timeline changes,
and enabled MCP tool effects remain explicit.

Motion in the expanded diagram explains causality rather than introducing whole
columns. Signal packets repeatedly traverse the exact responsive track between
stages and through the local timeline and answer exchange, while nearby nodes
briefly acknowledge their arrival. Each stage activates independently as it
enters view. Wide layouts use one four-stage row, medium containers use a 2 × 2
grid without decorative connectors, and narrow containers stack stages with
vertical packet tracks. Reduced-motion mode hides packets and preserves the
complete static story.

The public header stays uncluttered: Product, Use cases, Integrations, Agents,
and Pricing. Use cases and Integrations are `details` dropdowns on desktop and
in the mobile menu. Expandable rows show a down chevron when collapsed and an up
chevron when expanded; the mobile Menu overlay must not invert those icons.
Second-level nav popups use a hairline border, compact padding, and a short
black-based shadow in light and dark mode rather than a large foreground glow.
The Integrations dropdown is the hub, then Slack · Native sync and Telegram ·
Capture, then Google Drive, GitHub, Linear, Monday.com, Sentry, then Connect
MCP tools. Slack and Telegram keep those status labels so channel-history sync
is not confused with deliberate capture. Other live destinations stay as plain
product names. The menu does not list Jira or Notion as if they were native
integrations. Coming-soon tools stay on the integrations hub cards and their
pages, not in the header dropdown or footer Integrations column. How it works,
Help, Trust, and head-to-head Compare pages remain in the footer. The footer is
columnar: Product, Use cases, Integrations, Compare, and Legal. `/compare` is a
thin hub for head-to-head pages versus Day AI, Folk, Glean, Geekbot, Suda,
MemoryCrow, and Achiral. Those pages keep the honest “vs” framing and also
target “[competitor] alternatives” on the existing URLs rather than extra
doorway routes; every competitor fact cites and links that competitor's own
site. Notion stays under Integrations, never as a vs page.
Works-with pages live under `/integrations` (Linear, Jira, Notion, HubSpot,
Attio, Pipedrive), not under Compare: Linear has native ingest, Jira and Notion
explain hosted MCP lookup and link to `/integrations/mcp`, and HubSpot, Attio,
and Pipedrive native ingest is coming soon. `/integrations/mcp` is the general
guide for connecting third-party MCP servers to The Timeline Agent, distinct
from `/agents`. Retired `/compare/{hubspot,jira,linear,notion}` URLs
permanent-redirect to the matching integrations page.

Use-case pages extend this story for six jobs from one record: work record,
team daily log, communication trail, CRM, task board, and onboarding and repeat
questions. They live under `/use-cases`, appear in the public Use cases menu,
and are registered for sitemap and LLM discovery. `/compare` remains an
indexable vs-only hub reachable from the footer. `/agents` leads with agents as
teammates who report work into the record and read cited context back over MCP,
plus the same copyable setup card as the landing page. Retired solution URLs
`/solutions/weekly-project-updates` and `/solutions/crm-context-from-team-activity`
permanent-redirect to the matching use-case pages. Client project handoffs remain
at `/solutions/client-project-handoffs` with related use-case links. `/product-tour`
is a screenshot walkthrough linked from the home hero as See it first and from
pricing; `/integrations/telegram` is the public Telegram capture page. Product
screenshots live in `apps/web/public/marketing/screenshots` under the filenames
from the website copy plan. Landscape slots use a 16×10 top crop; mobile
portrait slots keep the full capture so Ask citations stay in frame. The
homepage shows three full-width proof shots (work record, stored cited Ask
answer, daily update). `/agents` pairs the current Agent tools screen with a
write-in / read-out diagram for external agents. `/integrations/mcp` has a
separate inbound live-lookup diagram for The Timeline Agent calling third-party
MCP tools. `/use-cases` opens with a conversations → work record → six jobs
diagram rather than a screenshot wall. Referenced screenshot files are
inventory-tested so a missing asset fails CI instead of shipping as a silent
placeholder. Public screenshot slots serve the committed PNG bytes (unoptimized)
so a recapture cannot stay hidden behind a stale image-optimizer cache. Ask
captures are stored fictional examples; captions say that plainly without
install or implementation noise.
Visible copy must stay consistent with deliberate capture, source-linked claims,
daily (not weekly) updates, and human review before inferred durable workspace
changes. Do not claim WhatsApp, Teams chat, or Slack Connect.

Public pages may use oversized Switzer display type, denser Commit Mono source
metadata, a near-black evidence-instrument canvas, and more cinematic spacing
than the authenticated Quiet Archive. Motion must explain provenance or
hierarchy, use transforms and opacity, and opt in only under
`prefers-reduced-motion: no-preference`; the default HTML is a complete static
narrative. Public pages still use one lime signal, hairline structure, and no
decorative AI gradients. Connector references distinguish native ingestion
(GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry), hosted live MCP
access, local-desktop MCP access, and planned support. Local-desktop entries
must never imply they connect from hosted Timeline; planned destinations stay
unlinked and unindexed until real. The landing claim owns the largest display
scale. Integration directory and connector-detail titles use a subordinate,
capped display scale so long provider headlines preserve the first viewport's
explanation and evidence.
Review dates, implementation labels, indexing state, and capability-tier names
belong in metadata and the typed content manifest, not visible marketing chrome.
Public copy explains the same truth through customer actions and constraints:
what enters the record, what is looked up only on request, what requires local
setup, and what cannot be connected yet.
The integration directory leads with implemented first-party capture surfaces:
Telegram and Slack conversation capture, forward/CC/BCC email,
participant-notification-gated-by-default Google Meet/Microsoft Teams/Zoom
transcripts, and named textual ingest webhooks.
It then presents the six native provider-record connectors separately. Slack
appears in both groups because conversational capture and selected-channel
history sync are distinct contracts; public copy must say so. Generic ingest
webhooks are evidence-only, meeting capture stores transcripts rather than raw
audio, and implemented surfaces may still require workspace or provider setup.
The directory uses the expanded public acquisition measure with a narrow fixed
section-index rail so two-up capture and provider cards retain a readable text
measure instead of being squeezed by a proportional sidebar.

Every public shell uses the landing masthead as one full-width chrome component,
with the same warm public palette, wordmark position, active state, GitHub and
theme controls, and lime account CTA. Signed-in visitors see `Dashboard`;
signed-out visitors see `Sign in` and `Start free` (free / no-card). Session-dependent
content reserves the larger of both states in a shared grid cell from the server
render onward. Pending and inactive branches remain invisible, inert, and hidden
from assistive technology; resolving authentication must not move adjacent content,
even when one branch is empty. The shared public canvas
inherits that warm paper palette in light mode and the landing's warm near-black
palette in dark mode, while each page group keeps its own content structure.
Auth-neutral loading and error boundaries keep the same masthead but omit
account actions rather than guessing the visitor's session state.
The landing main landmark remains focusable for skip navigation but suppresses
the browser's page-sized focus outline; interactive controls retain their focus indicators.
The masthead exposes five primary destinations in this order:
Product (`/`), Use cases (`/use-cases`), Integrations (`/integrations`), Agents (`/agents`),
and Pricing (`/pricing`). Desktop headers show them directly, compact widths use a native
menu disclosure, and the columnar footer repeats them plus How it works, Help, Compare, and Legal. The
current destination uses `aria-current="page"`. At phone widths, sign-in and
theme controls move into the disclosure instead of disappearing, and the
disclosure closes after link activation or a persisted-layout route change.
Native connector labels on the landing page link to their integration detail
pages, while native source badges in public walkthroughs link back to the same
provider truth. The landing hero and public navigation also link directly to
the project's source on GitHub; the
public help shell and developer docs repeat that path. Legal pages use the
shared public shell at reading width (65–70ch).
Public pricing copy explains plans, usage costs, and billing terms in customer language. Keep sandbox rollout status, implementation terminology, and internal launch assumptions in setup documentation rather than the pricing page.

Help uses the same public shell at wide width with a sidebar nav. Its overview
is one searchable, single-column guide directory rather than repeating the
same destinations in category lists and card grids. Guide and support pages
provide a visible route back to all guides; article bodies may optionally
constrain to a reading measure without forcing the shell narrow.
Agent setup guides may use a bespoke copy-ready pattern: one recommended install
prompt first, narrower skill-only and MCP-only fallbacks, then numbered setup,
usage guidance, and an explicit access FAQ. Copy controls stay adjacent to
their complete prompt or command, secrets never appear in those payloads, and
the guide remains searchable from the Help directory.

`/how-it-works` is the plain-language explanation of how Timeline works. It uses
the same 82rem acquisition grid, 13–15rem indexed section rail, hero scale,
footer, and section rhythm as the integration directory. A short hero leads
directly into the full-width animated platform flow; separate introductory step
cards and trust cards do not repeat that story. The diagram states the capture,
approval, citation, and enabled-MCP boundaries in context, then the next section
zooms into one source-to-answer provenance path. Practical walkthroughs remain
indexable for specific questions, but public navigation and page copy do not ask
visitors to learn an editorial publication, edition, playbook, or dossier
taxonomy.
The legacy `/record` URL permanently redirects to `/how-it-works`; it is not a
second indexable destination.

`/trust` is the public technical security and privacy reference. It follows the
expanded editorial grid, leads with the training-data boundary, then shows the data path,
AI routing, storage and access, processor roles, permissions, current assurance
status, and private vulnerability-reporting route. It must distinguish controls
enforced in code from production-account, contract, and certification evidence;
unverified badges and absolute “nothing leaves our servers” claims are
prohibited. Privacy and Terms remain the detailed legal surfaces and cross-link
Trust. A labelled Legal documents group on Trust links to Privacy, Terms, and
Cookies. Public copy describes customer-relevant controls, policies, and limitations;
operator checklists and evidence-collection tasks stay in the internal operating
standard. Once legal publication is ready, `/legal/accept` is an authenticated
blocking interstitial: one explicit acceptance covers the current Terms and
Privacy versions for that person, and protected product access does not continue
until it succeeds. While production publication is withheld, existing signed-in
users retain product access and `/legal/accept` returns them to the product.

`/cookies` uses the same legal-page reading surface for the exact cookie and
browser-storage inventory. It separates necessary storage, always-on personless
surface-request counts, optional public browser analytics, pseudonymous product
analytics, and reliability monitoring. The first-layer banner names the purpose only, offers equal Accept analytics
and Reject actions, and links Cookie settings. It does not name the vendor.
Cookie settings and the cookies notice name PostHog as the processor, with
purpose and documented retention. The working consent UI never initializes
PostHog before acceptance and never loads browser analytics inside private
workspace routes. Withdrawal stops capture and clears the public PostHog and
attribution state while keeping only the necessary consent-choice record. Every
public footer links the notice and exposes the persistent Cookie settings
control. Public copy calls the fixed-stream totals surface requests, not
visitors or sessions, and notes that bots and retries can contribute.

`/help/support` is both a channel router and the private support form. It sends
account-specific or sensitive requests to the private form/email, reproducible
non-sensitive defects to the structured public issue form, vulnerabilities to
the private security policy, and proposed contributions to the issue-first
contribution guide. Signed-in support context is disclosed and limited to
server-resolved account/team identifiers and role, a normalized app surface,
release, optional error reference, and bounded browser diagnostics. Never put
that context or workspace content in a GitHub issue. Dashboard desktop and
mobile footers use the same “Help & support” label; shared error states pair
Retry with a contextual Get support action.

Foundations and shared components: [design system](../../design.md).


### Public pricing calculator

The pricing Usage section compares PAYG, Team and Business through paired native
sliders and exact number fields. A labelled editable example renders on the server.
Desktop inputs sit beside a single hairline results panel; mobile stacks them.
Plan totals share one border with the selected breakdown underneath — no nested
cards or extra plan-card chrome. PAYG shows native allowances per meter; Team
and Business show a pooled usage-credit deduction. Capacity warnings exclude
unsuitable plans from the lowest-estimated-cost badge. Accepted sources live in
Advanced usage with their value visible when closed. Metadata stays at the 12px
floor. Rates and workspace eligibility remain in the closed How this estimate
works disclosure. Inputs stay local; the calculator neither changes billing nor
collects telemetry.
