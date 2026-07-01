import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ConnectionAttentionMessageInput,
  DailyDigestMessageInput,
  EmailVerificationMessageInput,
  MessageInput,
  MessageIntent,
  RenderedMessage,
  SupportRequestMessageInput,
  TeamInviteMessageInput,
  WelcomeMessageInput,
} from '#src/messaging/types.js';

import {
  digestContentSections,
  digestSummaryParagraphs,
  formatDigestCalendarEvent,
  formatDigestDate,
  formatDigestTask,
} from '#src/messaging/digest-format.js';

type TemplateName =
  | 'base'
  | 'daily-digest'
  | 'email-verification'
  | 'support-request'
  | 'team-invite'
  | 'welcome';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), 'email-templates');
const templateCache = new Map<TemplateName, string>();

function loadTemplate(name: TemplateName): string {
  const cached = templateCache.get(name);
  if (cached) return cached;
  const template = readFileSync(join(templateDir, `${name}.html`), 'utf8');
  templateCache.set(name, template);
  return template;
}

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

function renderTemplate(
  template: string,
  values: Record<string, string>,
  rawValues: Record<string, string> = {},
): string {
  return template
    .replaceAll(/\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}/g, (_match, key: string) => rawValues[key] ?? '')
    .replaceAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
      escapeHtml(values[key] ?? ''),
    );
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
  return renderTemplate(
    loadTemplate('base'),
    {
      preview: input.preview,
      title: input.title,
    },
    {
      body: input.body,
      ctaBlock: cta,
    },
  );
}

function htmlList(items: string[]): string {
  return items.length
    ? `<ul style="font-size: 14px; line-height: 1.55; padding-left: 20px;">${items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul>`
    : '<p style="font-size: 14px; color: #747b7b;">None</p>';
}

function htmlParagraphs(items: string[]): string {
  return items
    .map(
      (item) =>
        `<p style="font-size: 15px; line-height: 1.55; margin: 0 0 14px">${escapeHtml(item)}</p>`,
    )
    .join('\n');
}

function htmlDigestSections(sections: ReturnType<typeof digestContentSections>): string {
  return sections
    .map((section) =>
      [
        `<h2 style="font-size: 14px; margin: 20px 0 8px">${escapeHtml(section.title)}</h2>`,
        htmlList(section.items),
      ].join('\n'),
    )
    .join('\n');
}

function htmlListItems(items: string[]): string {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderBody(
  name: Exclude<TemplateName, 'base'>,
  values: Record<string, string>,
  rawValues: Record<string, string> = {},
): string {
  return renderTemplate(loadTemplate(name), values, rawValues);
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
    body: renderBody('team-invite', {
      inviterName: input.inviterName,
      teamName: input.teamName,
      roleLabel,
      expires,
      inviteUrl: input.inviteUrl,
    }),
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
    body: renderBody('support-request', {
      name: input.name,
      email: input.email,
      teamName: input.teamName ?? 'n/a',
      currentPage: input.currentPage ?? 'n/a',
      message: input.message,
    }),
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
    body: renderBody(
      'welcome',
      {
        name,
        teamName: input.teamName,
      },
      { steps: htmlListItems(steps) },
    ),
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
    body: renderBody('email-verification', {
      expires,
      verificationUrl: input.verificationUrl,
    }),
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
  const timezone = p.timezone;
  const windowEnd = formatDigestDate(p.windowEnd, timezone);
  const summaryParagraphs = digestSummaryParagraphs(p.summary);
  const sections = digestContentSections(p);
  const activityCountLine =
    typeof p.momentCount === 'number'
      ? `${p.momentCount} work moment${p.momentCount === 1 ? '' : 's'} from ${p.eventCount} source event${p.eventCount === 1 ? '' : 's'}`
      : `${p.eventCount} new timeline events`;
  const sourceLines = Object.entries(p.sourceDistribution).map(
    ([source, count]) => `${source}: ${count}`,
  );
  const objectLines = Object.entries(p.objectChangesByType).map(
    ([type, count]) => `${type}: ${count}`,
  );
  const textBody = [
    `Daily digest for ${p.teamName} · ${windowEnd}`,
    '',
    ...summaryParagraphs.flatMap((paragraph) => [paragraph, '']),
    ...sections.flatMap((section) => [
      section.title,
      ...section.items.map((item) => `- ${item}`),
      '',
    ]),
    '',
    `${p.pendingApprovals} pending approvals`,
    activityCountLine,
    sourceLines.length ? `Sources: ${sourceLines.join(', ')}` : 'Sources: none',
    objectLines.length ? `Objects changed: ${objectLines.join(', ')}` : 'Objects changed: none',
    '',
    'Current tasks:',
    ...(p.tasks.length
      ? p.tasks.map((task) => `- ${formatDigestTask(task, timezone)}`)
      : ['- None']),
    '',
    'Upcoming calendar:',
    ...(p.upcomingCalendar.length
      ? p.upcomingCalendar.map((event) => `- ${formatDigestCalendarEvent(event, timezone)}`)
      : ['- None']),
    '',
    `Open digest: ${input.digestUrl}`,
  ].join('\n');
  const htmlBody = htmlLayout({
    preview: p.summary,
    title: `Daily digest for ${p.teamName}`,
    body: renderBody(
      'daily-digest',
      {},
      {
        summaryBlock: htmlParagraphs(summaryParagraphs),
        summarySections: htmlDigestSections(sections),
        snapshotList: htmlList([
          `Digest date: ${windowEnd}`,
          `${p.pendingApprovals} pending approvals`,
          activityCountLine,
          sourceLines.length ? `Sources: ${sourceLines.join(', ')}` : 'No new sources',
          objectLines.length ? `Objects changed: ${objectLines.join(', ')}` : 'No object changes',
        ]),
        tasksList: htmlList(p.tasks.map((task) => formatDigestTask(task, timezone))),
        calendarList: htmlList(
          p.upcomingCalendar.map((event) => formatDigestCalendarEvent(event, timezone)),
        ),
      },
    ),
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

function renderConnectionAttention(input: ConnectionAttentionMessageInput): RenderedMessage {
  const subject = `Timeline integration needs attention for ${input.teamName}`;
  const preview = input.summary;
  const textBody = [
    input.summary,
    '',
    `Open integrations: ${input.actionUrl}`,
    '',
    'Existing timeline events remain available; this only affects future sync.',
  ].join('\n');
  const htmlBody = htmlLayout({
    preview,
    title: 'Integration needs attention',
    body: [
      `<p style="font-size: 14px; line-height: 1.55;">${escapeHtml(input.summary)}</p>`,
      '<p style="font-size: 13px; color: #747b7b;">Existing timeline events remain available; this only affects future sync.</p>',
    ].join('\n'),
    cta: { href: input.actionUrl, label: 'Open integrations' },
  });
  return {
    intent: 'connection_attention',
    to: input.to,
    subject,
    textBody,
    htmlBody,
    previewText: preview,
    metadata: { message_intent: 'connection_attention' },
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
    case 'connection_attention':
      return renderConnectionAttention(input as ConnectionAttentionMessageInput);
    default:
      intent satisfies never;
      throw new Error(`Unsupported message intent: ${String(intent)}`);
  }
}
