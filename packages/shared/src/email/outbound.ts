export interface TeamInviteEmailInput {
  to: string;
  inviterName: string;
  teamName: string;
  role: 'admin' | 'member';
  inviteUrl: string;
  expiresAt: Date;
}

export interface OutboundEmailResult {
  ok: boolean;
  error?: string;
}

export interface ConnectionAttentionEmailInput {
  to: string;
  teamName: string;
  summary: string;
  actionUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function configuredSender(): string | null {
  return process.env.TRANSACTIONAL_EMAIL_FROM ?? process.env.INVITE_EMAIL_FROM ?? null;
}

function shortError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 500);
  return 'Failed to send invite email';
}

export async function sendTeamInviteEmail(
  input: TeamInviteEmailInput,
): Promise<OutboundEmailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = configuredSender();
  if (!token || !from) {
    return { ok: false, error: 'Outbound email is not configured' };
  }

  const roleLabel = input.role === 'admin' ? 'an admin' : 'a member';
  const expires = input.expiresAt.toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const subject = `You're invited to join ${input.teamName} on The Timeline`;
  const textBody = [
    `${input.inviterName} invited you to join ${input.teamName} as ${roleLabel}.`,
    '',
    `Accept the invite: ${input.inviteUrl}`,
    '',
    `This invite expires on ${expires}.`,
  ].join('\n');
  const htmlBody = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #141414; line-height: 1.5;">
    <p>${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.teamName)}</strong> as ${escapeHtml(roleLabel)}.</p>
    <p><a href="${escapeHtml(input.inviteUrl)}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #fff; text-decoration: none; border-radius: 6px;">Join team</a></p>
    <p style="font-size: 13px; color: #666;">This invite expires on ${escapeHtml(expires)}.</p>
    <p style="font-size: 13px; color: #666;">If the button does not work, copy and paste this link:<br />${escapeHtml(input.inviteUrl)}</p>
  </body>
</html>`;

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': token,
      },
      body: JSON.stringify({
        From: from,
        To: input.to,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`.trim();
      try {
        const body = (await res.json()) as { Message?: string };
        if (body.Message) detail = body.Message;
      } catch {
        // Preserve the HTTP status fallback.
      }
      return { ok: false, error: detail.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: shortError(err) };
  }
}

export async function sendConnectionAttentionEmail(
  input: ConnectionAttentionEmailInput,
): Promise<OutboundEmailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = configuredSender();
  if (!token || !from) {
    return { ok: false, error: 'Outbound email is not configured' };
  }

  const subject = `Timeline integration needs attention for ${input.teamName}`;
  const textBody = [
    input.summary,
    '',
    `Open integrations: ${input.actionUrl}`,
    '',
    'Existing timeline events remain available; this only affects future sync.',
  ].join('\n');
  const htmlBody = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #141414; line-height: 1.5;">
    <p>${escapeHtml(input.summary)}</p>
    <p><a href="${escapeHtml(input.actionUrl)}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #fff; text-decoration: none; border-radius: 6px;">Open integrations</a></p>
    <p style="font-size: 13px; color: #666;">Existing timeline events remain available; this only affects future sync.</p>
  </body>
</html>`;

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': token,
      },
      body: JSON.stringify({
        From: from,
        To: input.to,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`.trim();
      try {
        const body = (await res.json()) as { Message?: string };
        if (body.Message) detail = body.Message;
      } catch {
        // Preserve the HTTP status fallback.
      }
      return { ok: false, error: detail.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: shortError(err) };
  }
}
