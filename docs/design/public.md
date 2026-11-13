# Public-site design patterns

The public site helps chat-run client delivery, product and operations teams
understand the work record, choose a useful starting point, and inspect its
boundaries. Preserve the official Timeline mark, Switzer typography, one lime
signal, and source-backed explanations. Start free is the primary acquisition
action; See it first links to the product tour. Warm paper and near-black are
plain, theme-matched surfaces, without a grain overlay.

## Landing narrative

The homepage leads with “Know where the work stands” and the animated source
flow. Explain the shared work record in plain language before presenting use
cases and capture options. Introduce the illustrative Acme rollout only in the
chronology walkthrough, after visitors understand the product. The cited answer
then demonstrates how that history helps answer a question. Do not place a
standalone Acme answer panel directly after the hero; it assumes context a new
visitor has not yet acquired.

The opening claim describes a living record built from selected tools and sources,
with connected clients, projects, tasks and decisions. Keep sources attached and
approval boundaries explicit; asking questions is one use of the record, not its
only outcome. Work continues through the use-case chooser, intake,
chronology, cited answer, connected records, audience fit with trust, and Start
free. Section headings carry the narrative without decorative numbered rails or
repeated eyebrows. Source timestamps, citation numbers and actual process order
remain meaningful metadata.

The six-use-case overview appears once, immediately after the hero. It presents
linked job rows before the detailed walkthrough. The intake section brings
supported capture surfaces, document uploads and native connectors together as
compact links. Frame the voice-note example around capturing updates, decisions
and commitments for later retrieval and cited answers, rather than transcription
as the primary benefit. Live MCP lookup and coming-soon connectors are not ingest options.
The nine-source animation sits beside the hero copy, with the plain-language product
introduction directly below. Use quiet curved paths and a slowly rotating wireframe record mesh;
source logos and selected-source boundaries carry the meaning. The output is a
compact record summary (“Decisions, promises & next steps” with “Sources attached”),
not a pair of button-like feature labels.
Keep one diagram instance, a keyboard-accessible pause control, offscreen and
hidden-tab suspension, and a static reduced-motion alternative. Extend source
paths into the hero background, faded behind copy. A coordinated twelve-second
sequence feeds source tiles, carries evidence into the record, then sends the
result onward. Leave the mesh unobstructed: no center badge, logo or work-record label.
Use visible junction nodes on the mesh; show Email, Google Drive and Linear
alongside Telegram, Slack, meetings, GitHub, documents and Sentry as surrounding sources. Precompute
the mesh projection without a canvas render loop or 3D dependency. Keep every
moving trace and mesh edge in the same pausable SVG timeline; use
only quiet static routes for reduced motion. Avoid continuous canvas rendering,
blur filters and unrelated particles. Mobile stacks
the diagram after the primary action without removing its source labels.

AgentSetupCard is always visible beneath the hero actions in its compact variant.
Use a short setup instruction, small official marks and the copyable command; do
not put this signup/setup path behind a disclosure.
The card explains agents reading the cited work record and writing notes back,
shows official Claude, ChatGPT, Cursor, Grok, OpenClaw and Hermes marks, and keeps
the copyable `Set up The Timeline - https://thetimeline.cc/llms.txt` command.
It uses the landing tokens in both themes. At narrow widths the command takes a
full row and the Copy control is at least 44px tall. Clipboard errors occupy
their own line so the command remains selectable and readable.

The Acme chronology retains five cited work sources, beginning with the linked
Telegram group. Captured work stays inspectable by source and time. The complete
cited answer keeps its source list visible alongside it on desktop and stacked
on mobile; each source has its details in place. Numbered references are static
labels matching those sources, not controls that require a modal or expansion.
The Chat and Agent comparison uses the same question, concise answer and local
source legend in two provider-neutral panels. Raw MCP tool calls and
provider-specific setup belong on their dedicated pages.

Connected records give Tasks, People, Projects, Companies and Deals equal
prominence, explaining purpose and relationships before the company-record
screenshot. The conversation → suggestion → approval → record sequence keeps
durable changes explicitly approval-backed. This is a product explanation, not
customer proof. Audience copy describes work spread across Slack or Telegram,
email, calls and documents. Updates are daily, without weekly framing.

Homepage screenshot captions own their supporting copy: search guidance belongs
with the timeline capture, approval guidance with the client record. Alternate
copy and screenshots on desktop and stack them on phones. Keep one specific
heading and short explanation per capture. The daily-update screenshot and trust
summary have a clear gap. The trust summary presents capture, immutability,
visibility and approval as flat evidence steps, with a direct Trust & Security
link; it does not imply certification.

Secondary-page closing CTAs are open, compact copy-and-action rows, side by side on desktop and
stacked on phones. Keep the action near the headline without repeated nested
panels, decorative labels or first-run walkthroughs. The product tour and pricing signup disclosure own the first-run path: create a team, connect one capture source,
then inspect a source-linked record or ask a question. Pricing leads with Start
free and no card; its estimator is optional planning.
The homepage closing action follows its heading and supporting paragraph in one
left-aligned column. Keep the signed-in “Open your Timeline” button and the
signed-out “Start free” button in the same position, with account and pricing
notes below. Do not float the action in a separate right-hand column.

## Evidence and motion

Acme rollout is the canonical fictional public story across landing, connector
and guide examples. Keep people, identifiers, records and outcomes coherent.
Real captures may show a different named project; distinguish that screen from
an adjacent story rather than implying a matching before/after result. Do not
recast examples as customer testimonials or measured proof, and avoid repeating
fictional-workspace disclaimers.

Substantive copy and diagrams are server-rendered and visible from first paint.
Scrolling and hydration never hide or slide the narrative into place. Motion
explains provenance or hierarchy; backgrounds remain still. Evidence flows run
only in view and pause offscreen. Reduced motion keeps the complete static
explanation and hides decorative packets. Every moving packet follows the exact
visible path; static paths and nodes do not compete with extra pulse animation.
There are no playback controls in public diagrams. Scroll progress updates its
own indicator, never an inherited property on the landing root.

The complete four-stage loop lives on `/how-it-works`. Its inputs group
conversations, meetings and documents, and delivery and incidents; five
representative events lead to useful records and a compact assistant exchange
across Web, Slack, Telegram and an own MCP agent. Permitted live CRM context,
approval-backed changes and enabled MCP tool effects stay explicit. Wide layouts
use one row, medium layouts a 2 × 2 grid without decorative connectors, and
narrow layouts stack stages. One-shot source-to-answer, external-agent and
inbound-MCP diagrams retain their complete static paths without JavaScript.

## Navigation and destinations

The public header stays uncluttered: Product, Use cases, Integrations, Agents,
and Pricing. Use cases and Integrations are `details` dropdowns on desktop and
in the mobile menu. Expandable rows show a down chevron when collapsed and an up
chevron when expanded; the mobile Menu overlay must not invert those icons.
Escape closes the focused dropdown and returns focus to its own summary. In the
mobile menu, dismiss a nested dropdown before dismissing the outer menu.
Second-level nav popups use a hairline border, compact padding, and a short
black-based shadow in light and dark mode rather than a large foreground glow.
The Integrations dropdown is the hub, then Slack · Native sync and Telegram ·
Capture, then Google Drive, GitHub, Linear, Monday.com, Sentry, then Connect
MCP tools. Slack and Telegram keep those status labels so channel-history sync
is not confused with deliberate capture. Other live destinations stay as plain
product names. The menu does not list Jira or Notion as if they were native
integrations. Coming-soon tools stay on the integrations directory and their
pages, not in the header dropdown or footer Integrations column. How it works,
Help, Trust, and head-to-head Compare pages remain in the footer. The footer is
columnar: Product, Use cases, Integrations, Compare, and Legal. The shared public footer
uses sentence-case Switzer labels and two columns on phones, with 44px-tall link
and cookie-setting targets. Mobile homepage scenes keep 48px vertical padding;
the hero starts at 40px and stacks its evidence example below the opening copy.
`/compare` is a
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
teammates who read the team’s cited context and write updates back, plus the
copyable AgentSetupCard. Retired solution URLs
`/solutions/weekly-project-updates` and `/solutions/crm-context-from-team-activity`
permanent-redirect to the matching use-case pages. Client project handoffs remain
at `/solutions/client-project-handoffs` with related use-case links. `/product-tour`
is a screenshot walkthrough linked from the home hero as See it first and from
pricing; `/integrations/telegram` is the public Telegram capture page. Product
screenshots live in `apps/web/public/marketing/screenshots` under the filenames
referenced by the public screenshot inventory. Each public slot has matching `<stem>-light.png`
and `<stem>-dark.png` twins from the same fictional seed and framing. The
resolved site theme selects one unoptimized image after hydration, including
saved Light/Dark overrides and System changes. No variant is preloaded before
the preference is known; the reserved loading frame prevents layout shift.
Each screenshot reserves its aspect box and shows a loading label until painted.
Screenshots are display-only, without links, zoom actions or instructions to click.
Inventory tests require both twins, including legacy unthemed mobile slots.
See the [recapture guide](../../apps/web/public/marketing/screenshots/README.md).
Landscape slots use a 16×10 top crop; mobile
portrait slots keep the full capture so Ask citations stay in frame. The
homepage shows proof shots in alternating split rows (screenshot beside the
copy, stacked on small screens): voice notes, work record, stored cited Ask
answer, client record, and daily update. On small screens those landscape
frames retain the same 16×10 aspect ratio. `/agents` pairs the current Agent
tools screen with a read-out / write-in diagram for external agents.
`/integrations/mcp` has a
separate inbound live-lookup diagram for The Timeline Agent calling third-party
MCP tools. `/use-cases` puts the six linked jobs first, grouped into Understand what
happened (work record and communication trail), Keep work moving (CRM and task
board), and Share the context (team daily log and onboarding). Each group has
an aligned heading and two descriptive link rows, followed by one shared-record
explanation. Do not repeat the chooser as a second diagram. Referenced screenshot files are
inventory-tested so a missing asset fails CI instead of shipping as a silent
placeholder. Public screenshot slots serve the committed PNG bytes (unoptimized)
so a recapture cannot stay hidden behind a stale image-optimizer cache. Ask
captures are stored examples; captions explain the pictured workflow without
repeated demo disclaimers or implementation noise.
Visible copy must stay consistent with deliberate capture, source-linked claims,
daily (not weekly) updates, and human review before inferred durable workspace
changes. Do not claim WhatsApp, Teams chat, or Slack Connect.

Public pages use responsive Switzer display headings, readable body copy and
Commit Mono for source metadata. Plain warm surfaces and deliberate whitespace
separate page jobs without repeating the authenticated application's density. Motion must explain provenance or
hierarchy, use transforms and opacity, and opt in only under
`prefers-reduced-motion: no-preference`; the default HTML is a complete static
narrative. Public pages still use one lime signal, hairline structure, and no
decorative AI gradients. Connector references distinguish native ingestion
(GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry), hosted live MCP
access, local-desktop MCP access, and planned support. Local-desktop entries
must never imply they connect from hosted Timeline; planned integrations remain clearly unavailable; links to explanatory pages
must not suggest that the connection itself can be enabled. The landing claim owns the largest display
scale. Integration directory and connector-detail titles use a subordinate,
capped display scale so long provider headlines preserve the first viewport's
explanation and evidence.
Review dates, implementation labels and indexing state belong in metadata and
the typed content manifest. Visible capability labels explain the available
connection: native sync, live lookup, local-only access or coming later.
Public copy explains the same truth through customer actions and constraints:
what enters the record, what is looked up only on request, what requires local
setup, and what cannot be connected yet.
The integration directory is a chooser before a guide. Three prominent local
links lead to capture, native sync and live lookup, with a subordinate link
to planned integrations. Telegram
and Slack conversation capture lead the compact capture rows; email forwarding,
meeting transcripts, ingest webhooks and websites remain available with their
existing boundaries. Capture details and limits stay in closed native
disclosures. Six native provider connectors have descriptive rows with visible
Native sync labels. Live lookup and planned integrations have distinct groups;
Local-desktop and complete provider lists use disclosures. Provider detail pages
supply the specific evidence examples; the directory prioritizes finding a source.

Slack conversation capture and selected-channel history sync remain separate
contracts. Generic ingest webhooks are evidence-only; meeting capture stores
transcripts rather than raw audio and uses participant notification by default.
Implemented surfaces may still require workspace or provider setup. Connector
detail pages expose local navigation to evidence, captured data, setup and
limits, with early setup guidance near the initial action. Keep complete
permission and recovery details accessible without expanding them by default.

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
the guide remains searchable from the Help directory. Expanded setup grids allow
children to shrink; long install controls wrap at phone widths without truncating
commands. Public setup copy controls reserve the larger idle/success label width.
Pointer success may fade the icon and label together for 120ms with
`cubic-bezier(0.22, 1, 0.36, 1)`; keyboard and reduced-motion feedback is immediate.
The existing status announcement, error recovery, and 1600ms reset remain.
Help search and pricing controls use 16px text on phones and retain the existing
desktop density. Help hover/press movement respects reduced motion; homepage
hover lift additionally requires a fine pointer with hover capability.

`/how-it-works` is the plain-language explanation of how Timeline works. It uses
the shared marketing container and aligned headings, with the same hero
scale, footer, and section rhythm as the integration directory. A short hero leads
directly into the full-width animated platform flow; separate introductory step
cards and trust cards do not repeat that story. The diagram states the capture,
approval, citation, and enabled-MCP boundaries in context, then the next section
zooms into one source-to-answer provenance path. Practical walkthroughs remain
indexable for specific questions, but public navigation and page copy do not ask
visitors to learn an editorial publication, edition, playbook, or dossier
taxonomy.
The legacy `/record` URL permanently redirects to `/how-it-works`; it is not a
second indexable destination.

`/trust` is the public technical security and privacy reference. A compact
introduction leads to local topic navigation: Data & evidence, AI & retention,
Access & deletion, Processors & policies, Assurance, and Deployment. Short facts
and the current independent-assurance limitation are visible near the top.
Question-led sections and flat evidence summaries make policy answers scannable;
exact request controls, processor roles and staff-access details remain in
native disclosures. The data-path section includes what Timeline preserves,
without a second full marketing trust-flow panel. It must distinguish controls
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

Account-entry forms keep input text at 16px on phones and may use the existing
14px desktop density. Inline legal and recovery links stay underlined. A wrong-account
invitation offers an explicit account switch that signs out, clears local session
state, and preserves a validated same-origin invitation destination. Leaving an
invitation is labelled “Not now”; it does not revoke the invite. Suspended-workspace
pages retain public support and sign-out actions. Missing required signup protection
keeps submission disabled and offers the configured support email as a recovery route.

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
Retry with a contextual Get support action. Saved support requests move focus to
an announced confirmation and expose the reference and any delivery warning immediately.
Pointer-submitted confirmations may fade their heading and instruction together over
160ms with `cubic-bezier(0.22, 1, 0.36, 1)`; references and warnings remain static.
Keyboard and reduced-motion confirmations are instant. Support inputs use 16px text
at phone widths without changing shared private-app input density.

Foundations and shared components: [design system](../../design.md).

### Public pricing

A compact no-card introduction leads directly to four catalog-backed plans.
Distinguish the platform fee from usage charges at the price, show included
members and pooled usage credit, and keep Free/PAYG monthly allowances visible
below the plans. The plan grid uses four columns on wide screens, two on tablet
and one on phones. No repeated plan-name eyebrows or recommended-plan badge.
The optional signup walkthrough is a disclosure; Enterprise is a quiet contact
line. Follow the estimator with complete comparison, spending boundaries,
billing-focused questions and a final Start free action.

Comparison tables have row/column scopes, a keyboard-focusable labelled scroll
region, a mobile scroll hint and a sticky row-label column. Billing copy makes
clear that spend caps exclude platform fees and tax, commitment credit is
applied after the cap check, and capacity limits are separate.

### Public pricing calculator

The pricing Usage section compares PAYG, Team and Business through paired native
sliders and exact number fields. A labelled editable example renders on the server.
Desktop inputs sit beside a single hairline results panel; mobile stacks them
with a compact selected-plan estimate that stays visible while editing. Number
inputs and slider targets are at least 44px high. Reset restores both the usage
example and Pay as you go selection. Invalid inputs suppress all estimates.
Plan totals share one border with the selected breakdown underneath — no nested
cards or extra plan-card chrome. PAYG shows native allowances per meter; Team
and Business show a pooled usage-credit deduction. Capacity warnings exclude
unsuitable plans from the lowest-estimated-cost badge. Accepted sources live in
Advanced usage with their value visible when closed. Metadata stays at the 12px
floor. Rates and workspace eligibility remain in the closed How this estimate
works disclosure. Inputs stay local; the calculator neither changes billing nor
collects telemetry.

Website scanning is an optional, closed disclosure in the pricing calculator. Expanded controls use a two-column grid and show one monthly page/unit subtotal; calculation assumptions are a secondary disclosure. The website feature page leads with the benefit and a concrete five-page price example, followed by three short benefits and expandable setup, limits, billing, and retention details.

The homepage hero disclosure, `/agents` page, agent help page, and authenticated Connect
your agent screen share AgentSetupCard and its generic llms.txt setup command. Client-specific setup starts
closed. Long agent instructions remain copyable payloads, never a visible Codex
text wall; advanced setup and access explanations are optional disclosures.

### Secondary marketing layout and policy disclosures

Use-case, integration, Trust and agents pages use `MarketingContainer` at
`max-w-6xl` with responsive gutters. Headings, prose, screenshots, walkthroughs
and related links share the page grid. Prose keeps a shorter reading measure
without narrowing its surrounding section. The homepage owns its independent
layout. Plain Switzer headings, moderate tracking and restrained signal accents
connect these surfaces; legal prose and private app screens retain their own
contracts. Commit Mono identifies timestamps, citations, counts and commands,
not decorative section labels. Use readable sentence-case labels instead of
small, widely tracked uppercase eyebrows. Standalone decorative eyebrows are
not public page scaffolding; retain functional breadcrumbs and source metadata.
Do not add numeric section rails when
sequence does not explain the work.

Use-case details pair a clear outcome and acquisition action with a readable,
semantic example of the work: chronology, daily update, agreement, customer,
proposed task or handoff. Examples are labelled illustrative and never imitate
clickable product controls. Preserve approval and visibility boundaries in the
example; CRM explicitly distinguishes Timeline records from planned external
CRM sync. A full-width, theme-matched product capture follows the explanation,
with further captures and FAQs supporting the specific use case. Keep complete
screenshot frames. The fictional Acme examples and Northstar product captures
remain separate. Source entries may arrive once with a brief transform/opacity
sequence; content is visible by default and reduced motion is static.

Integration details use short benefit headlines, explicit capability labels and
provider-specific evidence previews. Native sync, deliberate capture, live MCP
lookup and planned integrations must be distinguishable in the first viewport.
Provider setup and recovery belong in anchored sections after the value and
example; do not duplicate raw errors or OAuth prerequisites in the hero.
Native pages preserve captured-record lists, provider ownership, permissions,
limits, recipes and FAQ content. Questions are one way to use the work record,
not the whole pitch. Planned integrations show Today and Planned alongside the
introduction and link to available sources, never an unavailable connect flow.
MCP introduces live lookup beside the hero and keeps inbound tools separate
from external agents reading Timeline. Websites shows capture history before
its concrete scan price. Related tools use compact rows with readable status.

The use-case hub pairs its introduction with an illustrative shared record,
then groups six distinct outcomes by the visitor’s job. The integrations hub
leads with capture, native history and live-lookup choices, followed by a
compact two-column directory that stacks on mobile. Planned support is
subordinate and explicitly unavailable. Keep complete capture boundaries in
native disclosures; do not use long connector introductions as directory copy.

Agents keeps its copyable setup command visible beside the introduction and a
read/contribute example. Notes add evidence, not canonical changes. The
connection screenshot supports access instructions below; manual commands,
scopes and key details belong in an optional disclosure. Keep the distinction
between external agents reading Timeline and Timeline looking up external tools.
Native connector pages retain local section links. Telegram, MCP guides,
works-with pages and Trust keep a compact reading rhythm. Keep one idea per paragraph and
avoid repeating capture, approval and citation explanations. Policy detail uses
closed-by-default `MarketingDisclosure` elements: keyboard-accessible summaries
and complete content in the DOM. Short summaries never strengthen the underlying
promise. Privacy and Terms retain their legal text.

Homepage session metadata switches as one complete row. Signed-in mode keeps
the GitHub link at the left edge without reserving space for hidden pricing
copy. Both row variants reserve their shared height. Closing actions similarly
retain stable geometry when the session resolves.

Inline legal and closing-signup prose links remain underlined without hover.
Long technical values wrap without changing bytes or hiding content. Small
callout labels, homepage dim text and signal text meet 4.5:1 contrast against
their actual surfaces in both themes. Cookie preferences inherit the dialog's
viewport height cap and scrolling, with overscroll contained; all controls and
disclosures remain reachable on short screens. Reject and Accept stay equally
prominent in the compact desktop bottom-right analytics banner; no optional
analytics is sent before a choice. Cookie settings remains a persistent button
with the footer links' typography and treatment.

## Search and social previews

Shared homepage positioning lives in `apps/web/src/lib/product-positioning.ts`.
Use it for the hero, root metadata defaults, manifest and homepage registry entry.
Specialized pages retain their own search intent and capability boundaries in the
[public document registry](../public-site-registry.md).

OG and Twitter cards share a 1200 × 630 composition: the official mark, Switzer,
near-black background and lime emphasis. Describe the living record, connected
objects, attached sources and approval boundary; avoid fabricated event IDs or
version labels. Static social font subsets and their generation instructions live
in `apps/web/public/fonts/switzer/SOCIAL-FONTS.md`.
