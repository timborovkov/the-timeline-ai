# Polar PR review audit — 2026-10-31

PR: [#384](https://github.com/timborovkov/the-timeline-ai/pull/384). This audit covers all unresolved threads present at the start of the follow-up, including duplicate findings from the latest review. GitHub outdated status was not used as proof of resolution.

## Resolution evidence

### Subscription state and ordering

Account locking, provider event clocks, matching subscription IDs, status mapping, scheduled cancellation, cap preservation, and renewal-window checks replace the original unconditional updates.

Evidence: [packages/shared/src/billing/polar-webhook.ts](../../packages/shared/src/billing/polar-webhook.ts), [packages/shared/src/billing/polar-webhook.test.ts](../../packages/shared/src/billing/polar-webhook.test.ts).

Threads: [3847000676](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000676), [3847000680](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000680), [3847000709](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000709), [3847000731](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000731), [3853619309](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619309), [3855146381](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146381), [3864712991](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712991), [3865264930](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264930), [3865763429](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763429), [3865763438](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763438), [4366755101](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4366755101), [4368981127](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368981127), [4369951045](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369951045), [4408123021](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4408123021).

### Settlement, admission and recovery

Current settlement is transactional and account-locked, uses cumulative native-unit pricing and pending reservations, preserves admitted terms and historical windows, and delivers the payable remainder through an idempotent Polar outbox. Completed work can replay without new admission. Paid plans now invoice via Polar instead of the retired wallet model.

Evidence: [packages/shared/src/billing/scope.ts](../../packages/shared/src/billing/scope.ts), [packages/shared/src/billing/charge.ts](../../packages/shared/src/billing/charge.ts), [packages/shared/src/billing/scope.test.ts](../../packages/shared/src/billing/scope.test.ts), [packages/shared/src/billing/charge.test.ts](../../packages/shared/src/billing/charge.test.ts).

Threads: [3847000684](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000684), [3847000704](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000704), [3847000739](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000739), [3853619251](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619251), [3853619265](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619265), [3853619275](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619275), [3853619300](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619300), [3855146369](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146369), [3855146377](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146377), [3855146386](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146386), [3855146402](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146402), [3855146422](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146422), [3855146446](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146446), [3864286342](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286342), [3864286350](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286350), [3864712947](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712947), [3864712981](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712981), [3865264852](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264852), [3865264888](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264888), [3865264895](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264895), [3865763443](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763443), [3867531521](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531521), [3869701972](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701972), [3876740553](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740553), [4364810943](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4364810943), [4364810949](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4364810949), [4364810953](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4364810953), [4365648460](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365648460), [4365938551](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365938551), [4365938568](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365938568), [4367868814](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4367868814), [4371452615](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371452615), [4373372797](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4373372797), [4373841991](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4373841991), [4374720780](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4374720780), [4375327019](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4375327019), [4375327026](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4375327026), [4408123032](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4408123032), [4427634102](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4427634102), [4427839686](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4427839686).

### Runtime metering and historical facts

Runtime scopes include the provider; durable per-call IDs, preserved provider results/failed-attempt costs and admitted discounts support settlement retries. Member/storage facts retain historical plan, absence/membership intervals, month and renewal attribution. Period resets reread under the account lock.

Evidence: [packages/shared/src/billing/runtime.ts](../../packages/shared/src/billing/runtime.ts), [packages/shared/src/billing/runtime.test.ts](../../packages/shared/src/billing/runtime.test.ts).

Threads: [3847000687](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000687), [3853619336](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619336), [3855146430](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146430), [3864712962](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712962), [3865264907](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264907), [3867531495](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531495), [3869701987](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701987), [3870221664](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221664), [3871121962](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3871121962), [3876740543](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740543), [3876740546](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740546), [3876740557](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740557), [3876740562](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740562), [4361330055](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330055), [4361330067](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330067), [4361330079](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330079), [4361330087](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330087), [4366755106](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4366755106), [4367248734](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4367248734), [4369552350](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369552350), [4371161630](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371161630), [4372199304](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4372199304), [4427634094](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4427634094), [4427968818](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4427968818).

### Reservation expiry

Expiry locks accounts before reservations, releases legacy locks, and excludes provider-completed work or pending Recall/AI settlement from expiration.

Evidence: [packages/shared/src/billing/reservations.ts](../../packages/shared/src/billing/reservations.ts), [packages/shared/src/billing/scope.test.ts](../../packages/shared/src/billing/scope.test.ts), [packages/shared/src/billing/runtime.test.ts](../../packages/shared/src/billing/runtime.test.ts).

Threads: [3847000691](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000691), [4365648462](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365648462).

### LLM usage accounting

Provider usage survives schema/vector/transcript validation errors and structured fallbacks; model calls use stage/input-specific operation IDs. Vision replay stores plain output, and embeddings retain raw provider costs.

Evidence: [packages/shared/src/llm/chat.ts](../../packages/shared/src/llm/chat.ts), [packages/shared/src/llm/chat.test.ts](../../packages/shared/src/llm/chat.test.ts), [packages/shared/src/llm/embed.ts](../../packages/shared/src/llm/embed.ts), [packages/shared/src/llm/embed.test.ts](../../packages/shared/src/llm/embed.test.ts), [packages/shared/src/llm/transcribe.ts](../../packages/shared/src/llm/transcribe.ts), [packages/shared/src/llm/transcribe.test.ts](../../packages/shared/src/llm/transcribe.test.ts), [packages/shared/src/llm/vision.test.ts](../../packages/shared/src/llm/vision.test.ts).

Threads: [3847000698](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000698), [3855146438](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146438), [3867531514](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531514), [4368612534](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368612534), [4368981131](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368981131), [4369764168](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369764168), [4370374681](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4370374681), [4409149588](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4409149588).

### Email admission and settlement

Email reserves before Postmark, records accepted delivery before retryable settlement, and recovers accounting without resending. Verification, billing alerts, and support messages are exempt from workspace admission.

Evidence: [packages/shared/src/messaging/delivery.ts](../../packages/shared/src/messaging/delivery.ts), [packages/shared/src/messaging/delivery.test.ts](../../packages/shared/src/messaging/delivery.test.ts), [packages/shared/src/billing/runtime.test.ts](../../packages/shared/src/billing/runtime.test.ts).

Threads: [3847000701](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000701), [3864712972](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712972), [3869701960](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701960), [4365648461](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365648461), [4365938560](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365938560).

### Free grants and verification

Verified active owners receive one deterministic grant; concurrent inserts use conflict-safe claims, team creation is transactional, and restricted accounts retry grant assignment after sign-in. Remaining owner grants preserve access; releasing the last grant restricts Free access.

Evidence: [packages/db/drizzle/0075_billing_free_grant_backfill.sql](../../packages/db/drizzle/0075_billing_free_grant_backfill.sql), [packages/shared/src/billing/capacity.ts](../../packages/shared/src/billing/capacity.ts), [packages/shared/src/billing/capacity.test.ts](../../packages/shared/src/billing/capacity.test.ts), [packages/shared/src/billing/scope.test.ts](../../packages/shared/src/billing/scope.test.ts), [apps/web/src/lib/email-verification.ts](../../apps/web/src/lib/email-verification.ts), [apps/web/src/app/app/layout.tsx](../../apps/web/src/app/app/layout.tsx).

Threads: [3847000716](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000716), [3847000755](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000755), [3853619481](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619481), [3864286390](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286390), [3865264859](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264859), [3865264914](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264914), [3865763448](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763448), [3869701977](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701977), [3869701983](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701983), [3876740548](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740548), [4368119961](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368119961).

### Recall lifecycle

Atomic slot claims and provider duration limits bound admission. Joining/waiting time, no-shows, cancellation and retries preserve durable elapsed usage; worker settlement uses a system scope. Partial captures remain processing and billing backpressure propagates instead of finalizing transcript-only.

Evidence: [packages/shared/src/billing/admission.ts](../../packages/shared/src/billing/admission.ts), [packages/shared/src/meetings/quick-capture.ts](../../packages/shared/src/meetings/quick-capture.ts), [packages/shared/src/meetings/scope.ts](../../packages/shared/src/meetings/scope.ts), [packages/shared/src/meetings/scope.test.ts](../../packages/shared/src/meetings/scope.test.ts), [apps/worker/src/workers/meetingFinalize.test.ts](../../apps/worker/src/workers/meetingFinalize.test.ts), [apps/worker/src/workers/meetingScheduler.test.ts](../../apps/worker/src/workers/meetingScheduler.test.ts), [apps/web/src/app/actions/meetings.test.ts](../../apps/web/src/app/actions/meetings.test.ts).

Threads: [3847000721](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000721), [3847000744](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000744), [3853619396](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619396), [3853619414](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619414), [3864286378](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286378), [3864286383](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286383), [3869701955](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701955), [3869701967](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701967), [3869701980](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3869701980), [3870221674](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221674), [3876740570](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3876740570), [4369552352](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369552352), [4371808565](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371808565), [4371808567](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371808567), [4410367998](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4410367998).

### Retired wallet paths and subscription reuse

Wallet top-up/auto-reload purchase paths have been retired in favor of Polar subscription invoicing; stray historical top-up events are recorded and alerted without granting wallet credit. Existing non-terminal subscriptions are updated or routed to their portal rather than duplicated.

Evidence: [packages/shared/src/billing/polar.ts](../../packages/shared/src/billing/polar.ts), [packages/shared/src/billing/polar-checkout.test.ts](../../packages/shared/src/billing/polar-checkout.test.ts), [packages/shared/src/billing/polar-webhook.ts](../../packages/shared/src/billing/polar-webhook.ts), [packages/shared/src/billing/polar-webhook.test.ts](../../packages/shared/src/billing/polar-webhook.test.ts), [apps/web/src/app/actions/billing.ts](../../apps/web/src/app/actions/billing.ts).

Threads: [3847000727](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000727), [3853619323](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619323), [3853619443](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619443), [3855146472](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146472), [3864286357](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286357), [3864286370](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286370), [3865264839](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264839), [3870221701](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221701), [3870221706](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221706), [4365938547](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4365938547), [4366504870](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4366504870).

### Pricing and allowance presentation

Preview derives candidate prices from native usage and prorated member-days, avoids double-counting floors/seats, and reports meter-specific allowance status. Public copy describes the person-scoped Free grant.

Evidence: [packages/shared/src/billing/preview.ts](../../packages/shared/src/billing/preview.ts), [packages/shared/src/billing/preview.test.ts](../../packages/shared/src/billing/preview.test.ts), [packages/shared/src/billing/status.ts](../../packages/shared/src/billing/status.ts), [packages/shared/src/billing/status.test.ts](../../packages/shared/src/billing/status.test.ts), [apps/web/src/components/marketing/pricing-meters-explainer.tsx](../../apps/web/src/components/marketing/pricing-meters-explainer.tsx).

Threads: [3847000750](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3847000750), [3853619361](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619361), [3853619370](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619370), [3855146411](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146411), [3855146461](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146461), [3864286387](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286387), [3864286394](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286394), [3870221719](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221719), [3870221726](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221726).

### Checkout and operator authorization

Runtime plan validation, verified operator authorization, Polar-managed discount eligibility, subscription reuse, and exact external-ID customer resolution replace the affected paths.

Evidence: [apps/web/src/app/actions/billing.ts](../../apps/web/src/app/actions/billing.ts), [apps/web/src/app/actions/billing.test.ts](../../apps/web/src/app/actions/billing.test.ts), [packages/shared/src/billing/polar-checkout.test.ts](../../packages/shared/src/billing/polar-checkout.test.ts), [packages/shared/src/billing/operator-store.test.ts](../../packages/shared/src/billing/operator-store.test.ts), [packages/shared/src/billing/customer-identity.ts](../../packages/shared/src/billing/customer-identity.ts).

Threads: [3853619381](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619381), [3864712957](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712957), [4369264173](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369264173), [4369264178](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369264178), [4408643860](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4408643860).

### Capacity claims

Team-scoped locks serialize count-plus-insert/restore/seat claims; paused states and numeric storage totals are checked. Expired invitation renewals require a seat. The credential-thin extractor permits the live-billing toggle.

Evidence: [packages/shared/src/billing/capacity.ts](../../packages/shared/src/billing/capacity.ts), [packages/shared/src/billing/capacity.test.ts](../../packages/shared/src/billing/capacity.test.ts), [packages/shared/src/documents/scope.ts](../../packages/shared/src/documents/scope.ts), [packages/shared/src/documents/scope.test.ts](../../packages/shared/src/documents/scope.test.ts), [apps/web/src/app/actions/teams.ts](../../apps/web/src/app/actions/teams.ts), [apps/web/src/app/actions/teams.test.ts](../../apps/web/src/app/actions/teams.test.ts), [packages/shared/src/env.test.ts](../../packages/shared/src/env.test.ts).

Threads: [3853619463](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619463), [3855146453](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146453), [3855146480](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3855146480), [3864286361](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286361), [3864712937](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712937), [3865264867](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264867), [3865763462](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763462), [3865763468](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763468), [3867531501](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531501), [3867531505](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531505), [3867531516](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531516), [4409743753](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4409743753).

### Ask settlement

Compression/title and completed tool-step costs are retained; streamed/empty/aborted answers settle consumed work and preserve pending settlement instead of silently releasing completed usage.

Evidence: [apps/web/src/app/api/chat/route.ts](../../apps/web/src/app/api/chat/route.ts), [apps/web/src/app/api/chat/route.test.ts](../../apps/web/src/app/api/chat/route.test.ts), [packages/shared/src/agent/ask.ts](../../packages/shared/src/agent/ask.ts), [packages/shared/src/agent/ask.test.ts](../../packages/shared/src/agent/ask.test.ts).

Threads: [3853619427](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619427), [3853619450](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3853619450), [3865264879](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264879), [3867531491](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531491), [3871121923](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3871121923), [3871121946](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3871121946), [4361330045](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330045), [4369264169](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369264169), [4370892711](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4370892711).

### Deferred enrichment

Deferred work retains markers through attachment/queue failures, rotates blocked backlogs, enforces parent email admission and direct-chat accepted-source admission, and is excluded from orphan recovery.

Evidence: [apps/worker/src/workers/reconciliation.ts](../../apps/worker/src/workers/reconciliation.ts), [packages/shared/src/integrations/event-writer.ts](../../packages/shared/src/integrations/event-writer.ts), [packages/shared/src/integrations/event-writer.test.ts](../../packages/shared/src/integrations/event-writer.test.ts), [packages/shared/src/email/dispatcher.ts](../../packages/shared/src/email/dispatcher.ts), [packages/shared/src/email/dispatcher.test.ts](../../packages/shared/src/email/dispatcher.test.ts), [packages/shared/src/slack/dispatcher.ts](../../packages/shared/src/slack/dispatcher.ts), [packages/shared/src/telegram/dispatcher.ts](../../packages/shared/src/telegram/dispatcher.ts).

Threads: [3864286367](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864286367), [3864712925](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3864712925), [3867531509](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3867531509), [3870221692](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3870221692), [4368119958](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368119958), [4368612532](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368612532), [4370374679](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4370374679), [4371452619](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371452619), [4409743748](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4409743748).

### Webhook request validation

Webhook HMAC verification rejects timestamps outside five minutes; route input is capped before buffering and provider configuration is required before handling.

Evidence: [packages/shared/src/billing/polar.ts](../../packages/shared/src/billing/polar.ts), [apps/web/src/app/api/webhooks/polar/route.ts](../../apps/web/src/app/api/webhooks/polar/route.ts), [apps/web/src/app/api/webhooks/polar/route.test.ts](../../apps/web/src/app/api/webhooks/polar/route.test.ts).

Threads: [3865264941](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865264941), [3865763453](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3865763453).

### Shadow toggle

The disabled live-billing flag forces shadow mode even for an existing live account; enabling it applies live charging to existing shadow rows.

Evidence: [packages/shared/src/billing/shadow.ts](../../packages/shared/src/billing/shadow.ts), [packages/shared/src/billing/scope.test.ts](../../packages/shared/src/billing/scope.test.ts).

Threads: [3871121986](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r3871121986).

### Worker identity and backpressure

Worker calls use distinct durable IDs, summary generations are versioned, and billing admission errors survive LLM/summary/digest catches. Digest batches respect costly-worker concurrency.

Evidence: [apps/worker/src/billing-context.ts](../../apps/worker/src/billing-context.ts), [apps/worker/src/billing-context.test.ts](../../apps/worker/src/billing-context.test.ts), [apps/worker/src/workers/objectSummary.test.ts](../../apps/worker/src/workers/objectSummary.test.ts), [packages/shared/src/messaging/digest.ts](../../packages/shared/src/messaging/digest.ts), [packages/shared/src/messaging/digest.mapreduce.test.ts](../../packages/shared/src/messaging/digest.mapreduce.test.ts), [packages/shared/src/billing/admission-propagation.test.ts](../../packages/shared/src/billing/admission-propagation.test.ts).

Threads: [4361330026](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4361330026), [4364810958](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4364810958), [4369264166](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369264166), [4408123041](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4408123041), [4408643855](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4408643855).

### Historical plan and renewal replay

Initial Free history, exact usage instants/period tags, renewal windows and calendar anchor preservation determine replay pricing and discount consumption.

Evidence: [packages/shared/src/billing/plan-history.ts](../../packages/shared/src/billing/plan-history.ts), [packages/shared/src/billing/plan-history.test.ts](../../packages/shared/src/billing/plan-history.test.ts), [packages/shared/src/billing/charge.test.ts](../../packages/shared/src/billing/charge.test.ts).

Threads: [4364810961](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4364810961), [4368119952](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4368119952), [4369951037](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369951037), [4369951041](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369951041), [4370181023](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4370181023), [4371161627](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4371161627), [4373372800](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4373372800).

### Migration journal preservation

Billing migrations are appended after main history; applied journal entries are preserved. PGlite migration-backed billing suites exercise the resulting schema.

Evidence: [packages/db/drizzle/meta/_journal.json](../../packages/db/drizzle/meta/_journal.json), [docs/testing/polar-team-identity.md](../../docs/testing/polar-team-identity.md).

Threads: [4369264170](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4369264170).

### Object-note search metering

searchObjectNotes runs query embedding under withSearchEmbeddingBilling, retaining the team/member visibility boundary.

Evidence: [packages/shared/src/team-scope.ts](../../packages/shared/src/team-scope.ts), [packages/shared/src/team-scope.test.ts](../../packages/shared/src/team-scope.test.ts).

Threads: [4407631818](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4407631818).

### Optional onboarding

Billing stays visible but is excluded from next-item selection, so Free users retain progression and completion controls for required onboarding steps.

Evidence: [apps/web/src/components/onboarding-checklist.tsx](../../apps/web/src/components/onboarding-checklist.tsx), [apps/web/src/components/onboarding-checklist.test.tsx](../../apps/web/src/components/onboarding-checklist.test.tsx).

Threads: [4428140124](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4428140124).

### Final-lock revocation race

Fixed in this follow-up: final membership completion rejects a remaining remote member if first setup raced preparation. A retry must complete external revocation first.

Evidence: [packages/shared/src/billing/customer-identity.ts](../../packages/shared/src/billing/customer-identity.ts), [packages/shared/src/billing/customer-identity.test.ts](../../packages/shared/src/billing/customer-identity.test.ts).

Threads: [4429557153](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429557153), [4429718597](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429718597).

### Interrupted conversion recovery

Fixed in this follow-up: CLI preflight and resolver share unique verified-owner recovery within the verified customer, without overriding conflicting bindings. Immutable legacy external IDs remain pinned.

Evidence: [scripts/billing-polar-convert.ts](../../scripts/billing-polar-convert.ts), [packages/shared/src/billing/customer-identity.ts](../../packages/shared/src/billing/customer-identity.ts), [packages/shared/src/billing/customer-identity.test.ts](../../packages/shared/src/billing/customer-identity.test.ts).

Threads: [4429557158](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429557158), [4429718600](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429718600).

### Independent legacy customer access

Addressed with a fail-closed alternative: silently retaining customer email is unsafe because Polar sends independent customer-scoped access links. Revocation requires verified email cleanup; provider refusal leaves the operation pending and blocks local removal/new sessions. Owner member email remains required. Provider cleanup is an explicit limitation, not claimed complete.

Evidence: [packages/shared/src/billing/customer-identity.ts](../../packages/shared/src/billing/customer-identity.ts), [packages/shared/src/billing/customer-identity.test.ts](../../packages/shared/src/billing/customer-identity.test.ts), [docs/testing/polar-team-identity.md](../../docs/testing/polar-team-identity.md).

Threads: [4429557164](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429557164), [4429718604](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429718604).

## Verification

- 986 distinct synthetic tests passed across 51 affected test files. The initial audit found one stale webhook-route expectation; it was corrected and the entire route file reran successfully, including a new missing-provider case. The other audited tests passed without changes. Conversion/revocation and digest-backpressure regressions also passed.
- Full `bun run build`, scoped ESLint/formatting, conversion-script TypeScript check, `bun run test:dist-imports`, and `git diff --check` passed.
- GitHub Actions run `41153070163` did not start its static job: GitHub reports the repository account is locked due to a billing issue. This is separate from the passing local checks.
- `/document-release` is not installed in this environment. Manual handoff checked README, TODO, setup, ADR, trust/evidence documentation and audit links against the final diff.
- No real purchases, database resets, environment edits, or PR merge were performed in this follow-up.

## Second review cycle: provisioning rollback and locked checkout state

Codex reviewed `3026c6b1` and identified two further races:

- [Uncommitted remote identities](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429818309): organization/environment binding now commits as provisioning intent before remote writes. Removal persists pending intent even without a customer ID, resolves the exact external ID, and revokes surviving remote members before local completion. The `revoke:<role>` phase cannot complete locally; only confirmed revocation changes it to the target role. Provider/configuration failures leave it blocked. No schema change or email-based customer discovery is used.
- [Stale checkout account](https://github.com/timborovkov/the-timeline-ai/pull/384#discussion_r4429818314): the identity wrapper passes its locked current account to session callbacks. Self-service checkout resolves discounts and chooses subscription update versus checkout using that row, with renewed comp/Enterprise checks. Portal and Enterprise/operator checkout also recheck current arrangements and authorization; Enterprise discounts and inherited terms use the locked row.

Regressions cover a successful remote admin write followed by local rollback,
provider loss before recovery, removal pending before first setup, subscription
activation between preflight and issuance, changed comp/Enterprise/discount terms,
and a comp applied while an operator closes a previous checkout. Follow-up
validation includes the identity, billing-action, team-action and operator-store
suites. Lint also identified and removed non-null assertions and redundant optional
chains in owner recovery; static checks are rerun on the final code.

Second-cycle validation: 88 distinct affected tests passed; the full build, scoped lint/formatting, conversion-script typecheck, compiled-import checks, and diff checks passed on the follow-up.
