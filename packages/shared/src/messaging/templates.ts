import type {
  DailyDigestMessageInput,
  EmailVerificationMessageInput,
  MessageInput,
  MessageIntent,
  RenderedMessage,
  SupportRequestMessageInput,
  TeamInviteMessageInput,
  WelcomeMessageInput,
} from '#src/messaging/types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

function htmlLayout(input: {
  preview: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}): string {
  const cta = input.cta
    ? `<p style="margin: 24px 0;"><a href="${escapeHtml(input.cta.href)}" style="display: inline-block; padding: 10px 14px; background: #68a500; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 600;">${escapeHtml(
        input.cta.label,
      )}</a></p>`
    : '';
  return `<!doctype html>
<html>
  <body style="margin: 0; background: #f6f7f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #171717;">
    <div style="display: none; max-height: 0; overflow: hidden;">${escapeHtml(input.preview)}</div>
    <main style="max-width: 640px; margin: 0 auto; padding: 32px 20px;">
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: #68a500; font-size: 12px; margin-bottom: 20px;">The Timeline</div>
      <section style="background: #fff; border: 1px solid #d8dddd; border-radius: 6px; padding: 24px;">
        <h1 style="font-size: 22px; line-height: 1.25; margin: 0 0 16px;">${escapeHtml(input.title)}</h1>
        ${input.body}
        ${cta}
      </section>
      <p style="font-size: 12px; color: #747b7b; margin-top: 20px;">You received this because this address is connected to The Timeline.</p>
    </main>
  </body>
</html>`;
}

function paragraphs(lines: string[]): string {
  return lines
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        `<p style="font-size: 15px; line-height: 1.55; margin: 0 0 14px;">${escapeHtml(line)}</p>`,
    )
    .join('');
}

function renderTeamInvite(input: TeamInviteMessageInput): RenderedMessage {
  const roleLabel = input.role === 'admin' ? 'an admin' : 'a member';
  const expires = formatDate(input.expiresAt);
  const subject = `You're invited to join ${input.teamName} on The Timeline`;
  const preview = `${input.inviterName} invited you to join ${input.teamName}.`;
  const textBody = [
    `${input.inviterName} invited you to join ${input.teamName} as ${roleLabel}.`,
    '',
    `Accept the invite: ${input.inviteUrl}`,
    '',
    `This invite expires on ${expires}.`,
  ].join('\n');
  const htmlBody = htmlLayout({
    preview,
    title: `Join ${input.teamName}`,
    body: paragraphs([
      `${input.inviterName} invited you to join ${input.teamName} as ${roleLabel}.`,
      `This invite expires on ${expires}.`,
      `If the button does not work, copy and paste this link: ${input.inviteUrl}`,
    ]),
    cta: { href: input.inviteUrl, label: 'Join team' },
  });
  return {
    intent: 'team_invite',
    to: input.to,
    subject,
    textBody,
    htmlBody,
    previewText: preview,
    metadata: { message_intent: 'team_invite' },
  };
}

function renderSupportRequest(input: SupportRequestMessageInput): RenderedMessage {
  const subject = `[Timeline support] ${input.requestType} from ${input.name}`;
  const textBody = [
    `Support request ${input.requestId}`,
    `Type: ${input.requestType}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Current page: ${input.currentPage ?? 'n/a'}`,
    `User ID: ${input.userId ?? 'anonymous'}`,
    `Team ID: ${input.teamId ?? 'n/a'}`,
    `Team: ${input.teamName ?? 'n/a'}`,
    '',
    input.message,
  ].join('\n');
  const htmlBody = htmlLayout({
    preview: `Support request from ${input.name}`,
    title: `Support request: ${input.requestType}`,
    body: `${paragraphs([
      `From ${input.name} <${input.email}>`,
      `Team: ${input.teamName ?? 'n/a'}`,
      `Current page: ${input.currentPage ?? 'n/a'}`,
    ])}<pre style="white-space: pre-wrap; font-size: 14px; line-height: 1.5; background: #f6f7f7; border: 1px solid #d8dddd; padding: 12px; border-radius: 4px;">${escapeHtml(
      input.message,
    )}</pre>`,
  });
  return {
    intent: 'support_request',
    to: input.supportEmail,
    replyTo: input.email,
    subject,
    textBody,
    htmlBody,
    previewText: `Support request from ${input.name}`,
    metadata: {
      message_intent: 'support_request',
      support_request_id: input.requestId,
      request_type: input.requestType,
    },
  };
}

function renderWelcome(input: WelcomeMessageInput): RenderedMessage {
  const name = input.name?.trim() ?? 'there';
  const subject = 'Welcome to The Timeline';
  const preview = `Start capturing what matters for ${input.teamName}.`;
  const steps = [
    'Capture one note, decision, or follow-up.',
    'Connect Telegram, Slack, email ingest, or your calendar.',
    'Review pending approvals so the timeline turns activity into durable memory.',
  ];
  const textBody = [
    `Hi ${name},`,
    '',
    `Welcome to The Timeline. Your ${input.teamName} workspace is ready.`,
    '',
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    `Open your dashboard: ${input.dashboardUrl}`,
  ].join('\n');
  const htmlBody = htmlLayout({
    preview,
    title: 'Welcome to The Timeline',
    body: `${paragraphs([
      `Hi ${name}, welcome in. Your ${input.teamName} workspace is ready.`,
      'A good first pass is simple:',
    ])}<ol style="font-size: 15px; line-height: 1.55; padding-left: 22px;">${steps
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join('')}</ol>`,
    cta: { href: input.dashboardUrl, label: 'Open dashboard' },
  });
  return {
    intent: 'welcome',
    to: input.to,
    subject,
    textBody,
    htmlBody,
    previewText: preview,
    metadata: { message_intent: 'welcome' },
  };
}

function renderEmailVerification(input: EmailVerificationMessageInput): RenderedMessage {
  const expires = formatDate(input.expiresAt);
  const subject = 'Verify your email for The Timeline';
  const preview = 'Confirm this email address to finish setting up The Timeline.';
  const textBody = [
    'Verify your email address for The Timeline.',
    '',
    `Verify email: ${input.verificationUrl}`,
    '',
    `This link expires on ${expires}.`,
  ].join('\n');
  const htmlBody = htmlLayout({
    preview,
    title: 'Verify your email',
    body: paragraphs([
      'Confirm this email address to finish setting up The Timeline.',
      `This link expires on ${expires}.`,
      `If the button does not work, copy and paste this link: ${input.verificationUrl}`,
    ]),
    cta: { href: input.verificationUrl, label: 'Verify email' },
  });
  return {
    intent: 'email_verification',
    to: input.to,
    subject,
    textBody,
    htmlBody,
    previewText: preview,
    metadata: { message_intent: 'email_verification' },
  };
}

function renderDailyDigest(input: DailyDigestMessageInput): RenderedMessage {
  const p = input.payload;
  const subject = `Daily digest for ${p.teamName}`;
  const sourceLines = Object.entries(p.sourceDistribution).map(
    ([source, count]) => `${source}: ${count}`,
  );
  const objectLines = Object.entries(p.objectChangesByType).map(
    ([type, count]) => `${type}: ${count}`,
  );
  const textBody = [
    `Daily digest for ${p.teamName}`,
    '',
    p.summary,
    '',
    `${p.pendingApprovals} pending approvals`,
    `${p.eventCount} new timeline events`,
    sourceLines.length ? `Sources: ${sourceLines.join(', ')}` : 'Sources: none',
    objectLines.length ? `Objects changed: ${objectLines.join(', ')}` : 'Objects changed: none',
    '',
    'Current tasks:',
    ...(p.tasks.length ? p.tasks.map((task) => `- ${task.title} (${task.status})`) : ['- None']),
    '',
    'Upcoming calendar:',
    ...(p.upcomingCalendar.length
      ? p.upcomingCalendar.map((event) => `- ${event.title} (${event.startAt})`)
      : ['- None']),
    '',
    `Open digest: ${input.digestUrl}`,
  ].join('\n');
  const list = (items: string[]) =>
    items.length
      ? `<ul style="font-size: 14px; line-height: 1.55; padding-left: 20px;">${items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '<p style="font-size: 14px; color: #747b7b;">None</p>';
  const htmlBody = htmlLayout({
    preview: p.summary,
    title: `Daily digest for ${p.teamName}`,
    body: `${paragraphs([p.summary])}
      <h2 style="font-size: 14px; margin: 20px 0 8px;">Snapshot</h2>
      ${list([
        `${p.pendingApprovals} pending approvals`,
        `${p.eventCount} new timeline events`,
        sourceLines.length ? `Sources: ${sourceLines.join(', ')}` : 'No new sources',
        objectLines.length ? `Objects changed: ${objectLines.join(', ')}` : 'No object changes',
      ])}
      <h2 style="font-size: 14px; margin: 20px 0 8px;">Current tasks</h2>
      ${list(p.tasks.map((task) => `${task.title} (${task.status})`))}
      <h2 style="font-size: 14px; margin: 20px 0 8px;">Upcoming calendar</h2>
      ${list(p.upcomingCalendar.map((event) => `${event.title} (${event.startAt})`))}`,
    cta: { href: input.digestUrl, label: 'Open digest' },
  });
  return {
    intent: 'daily_digest',
    to: input.to,
    subject,
    textBody,
    htmlBody,
    previewText: p.summary,
    metadata: { message_intent: 'daily_digest' },
  };
}

export function renderMessage<TIntent extends MessageIntent>(
  intent: TIntent,
  input: MessageInput<TIntent>,
): RenderedMessage {
  switch (intent) {
    case 'team_invite':
      return renderTeamInvite(input as TeamInviteMessageInput);
    case 'support_request':
      return renderSupportRequest(input as SupportRequestMessageInput);
    case 'welcome':
      return renderWelcome(input as WelcomeMessageInput);
    case 'email_verification':
      return renderEmailVerification(input as EmailVerificationMessageInput);
    case 'daily_digest':
      return renderDailyDigest(input as DailyDigestMessageInput);
    default:
      intent satisfies never;
      throw new Error(`Unsupported message intent: ${String(intent)}`);
  }
}
