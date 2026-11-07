import {
  isLoopbackHostname,
  McpOAuthError,
  type McpOAuthScope,
  validateMcpAuthorizationRequest,
} from '@timeline/shared/mcp-server';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { ConsentMembership } from '@/components/oauth-consent-form';
import type { McpAuthorizationInput } from '@/lib/mcp-oauth-authorization';
import type { ValidatedAuthorizationRequest } from '@timeline/shared/mcp-server';
import type { Metadata } from 'next';

import { denyMcpOAuthAction } from '@/app/oauth/actions';
import { AuthShell } from '@/components/auth-shell';
import { OAuthConsentForm } from '@/components/oauth-consent-form';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import {
  authorizationHiddenFields,
  authorizationInputFromSearchParams,
  MCP_AUTHORIZATION_NOTICES,
  mcpAuthorizationNoticeFromSearchParam,
  mcpAuthorizationLegalAcceptancePath,
  mcpAuthorizationPath,
  type McpAuthorizationSearchParams,
} from '@/lib/mcp-oauth-authorization';
import {
  mcpOAuthResource,
  oauthAuthorizationErrorRedirect,
  oauthAuthorizationRedirect,
} from '@/lib/mcp-oauth-server';

export const metadata: Metadata = {
  title: 'Authorize app',
  description: 'Review an app’s request to access your Timeline workspace.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const scopeDescriptions: Record<McpOAuthScope, { title: string; description: string }> = {
  read: {
    title: 'Read your Timeline data',
    description:
      'Read Timeline data you can access in the selected team, including private items and items shared specifically with you.',
  },
  capture: {
    title: 'Capture notes in Timeline',
    description:
      'Store agent notes as cited Timeline evidence with timeline.remember. Capture is on by default; uncheck it for a read-only grant.',
  },
  'agent:ask': {
    title: 'Ask the Timeline agent',
    description:
      'Ask the Timeline agent. It may create team-visible proposals and use enabled team tools that can affect external services. Only team owners and admins can grant this access; it is revoked if their role changes to member.',
  },
};

const consentErrorMessages = {
  [MCP_AUTHORIZATION_NOTICES.invalidTeam]: 'Choose a valid team before allowing access.',
  [MCP_AUTHORIZATION_NOTICES.requestFailed]:
    'Timeline could not complete this authorization request. Review the request and try again.',
} as const;

function urlHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function HiddenAuthorizationFields({
  input,
}: {
  input: ReturnType<typeof authorizationInputFromSearchParams>;
}) {
  return authorizationHiddenFields(input).map((field) => (
    <input key={field.name} type="hidden" name={field.name} value={field.value} />
  ));
}

function AuthorizationError({ message }: { message: string }) {
  return (
    <AuthShell
      title="Authorization request unavailable"
      subtitle="Timeline did not redirect because the app’s callback could not be trusted."
    >
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm leading-6 text-fg">{message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/app">Return to Timeline</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/help">Get help</Link>
        </Button>
      </div>
    </AuthShell>
  );
}

export default async function McpOAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<McpAuthorizationSearchParams & { consent_error?: string | string[] }>;
}) {
  const params = await searchParams;
  const input = authorizationInputFromSearchParams(params);
  const callbackPath = mcpAuthorizationPath(input);
  const session = await auth();
  if (!session?.user.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }

  let validation:
    | {
        ok: true;
        request: Awaited<ReturnType<typeof validateMcpAuthorizationRequest>>;
      }
    | { ok: false; destination: string | null; message: string };
  try {
    validation = {
      ok: true,
      request: await validateMcpAuthorizationRequest(db, input, mcpOAuthResource()),
    };
  } catch (error) {
    validation = {
      ok: false,
      destination: oauthAuthorizationErrorRedirect(error),
      message:
        error instanceof McpOAuthError
          ? error.message
          : 'Timeline could not verify this authorization request.',
    };
  }
  if (!validation.ok) {
    if (validation.destination) {
      // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- The shared validator supplies an external destination only after exact registered redirect URI validation; the helper returns only safe error fields, validated state, and issuer binding.
      redirect(validation.destination);
    }
    return <AuthorizationError message={validation.message} />;
  }
  const { request } = validation;

  const legal = await getUserLegalAcceptance(session.user.id);
  if (!legal || !hasCurrentLegalAcceptance(legal)) {
    redirect(mcpAuthorizationLegalAcceptancePath(input));
  }

  const { active, memberships } = await resolveActiveTeam(session.user.id);
  if (!active || memberships.length === 0) {
    const destination = oauthAuthorizationRedirect(request.redirectUri, {
      error: 'access_denied',
      error_description: 'The authorization request was denied.',
      state: request.state,
    });
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- The destination is the exact registered redirect URI validated above; only a code-owned error and the validated state are returned.
    redirect(destination);
  }
  const consentMemberships = await Promise.all(
    memberships.map(async (membership) => ({
      ...membership,
      reporting: await withTeam(
        db,
        membership.teamId,
        session.user.id,
      ).agentReporting.consentContext(request.client.clientId),
    })),
  );
  const clientIdHost = urlHostname(request.client.clientId);
  const redirectHost = urlHostname(request.redirectUri);
  const loopbackRedirect = redirectHost ? isLoopbackHostname(redirectHost) : false;
  const requiresTeamAdmin = request.scopes.includes('agent:ask');
  const eligibleMemberships = requiresTeamAdmin
    ? memberships.filter((membership) => membership.role !== 'member')
    : memberships;
  const defaultTeamId =
    eligibleMemberships.find((membership) => membership.teamId === active.teamId)?.teamId ??
    eligibleMemberships[0]?.teamId ??
    null;
  const consentNotice = mcpAuthorizationNoticeFromSearchParam(params.consent_error);
  const consentError = consentNotice ? consentErrorMessages[consentNotice] : null;

  return (
    <OAuthConsentPage
      request={request}
      clientIdHost={clientIdHost}
      redirectHost={redirectHost}
      loopbackRedirect={loopbackRedirect}
      consentError={consentError}
      input={input}
      requiresTeamAdmin={requiresTeamAdmin}
      memberships={consentMemberships}
      defaultTeamId={defaultTeamId}
    />
  );
}

function OAuthConsentPage({
  request,
  clientIdHost,
  redirectHost,
  loopbackRedirect,
  consentError,
  input,
  requiresTeamAdmin,
  memberships,
  defaultTeamId,
}: {
  request: ValidatedAuthorizationRequest;
  clientIdHost: string | null;
  redirectHost: string | null;
  loopbackRedirect: boolean;
  consentError: string | null;
  input: McpAuthorizationInput;
  requiresTeamAdmin: boolean;
  memberships: ConsentMembership[];
  defaultTeamId: string | null;
}) {
  return (
    <AuthShell
      maxWidth="lg"
      title={`Allow ${request.client.clientName} to access Timeline?`}
      subtitle="Verify the app identity and callback below. Timeline will share data only from the team you choose."
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-bg-subtle p-3">
        <div
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-sm font-semibold uppercase text-fg"
        >
          {request.client.clientName.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{request.client.clientName}</p>
          <p className="truncate text-xs text-fg-muted">
            {clientIdHost ? `Client metadata host: ${clientIdHost}` : 'Client-provided identity'}
          </p>
        </div>
      </div>

      <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <p className="text-sm font-semibold text-fg">Verify this app before continuing</p>
        <p className="mt-1 text-xs leading-5 text-fg-muted">
          The app name and identity details are provided by the client, not verified by Timeline.
          Continue only if you started this connection and recognize its client ID and callback.
        </p>
      </div>

      <dl className="space-y-3 rounded-md border border-border p-3 text-xs">
        <div className="space-y-1">
          <dt className="font-medium text-fg">Client ID</dt>
          <dd className="break-all font-mono leading-5 text-fg-muted">{request.client.clientId}</dd>
        </div>
        <div className="space-y-1">
          <dt className="font-medium text-fg">Registered redirect hostname</dt>
          <dd className="break-all font-mono leading-5 text-fg-muted">
            {redirectHost ?? 'Unavailable'}
          </dd>
        </div>
      </dl>

      {loopbackRedirect ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-semibold text-fg">This callback stays on your device</p>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            The app will send the authorization result to a local loopback address. Continue only if
            you started and trust the local app requesting access.
          </p>
        </div>
      ) : null}

      {consentError ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm leading-6 text-fg">{consentError}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Requested access</h2>
        <ul className="space-y-2">
          {request.scopes
            .filter((scope) => scope !== 'capture')
            .map((scope) => (
              <li key={scope} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-fg">{scopeDescriptions[scope].title}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">
                  {scopeDescriptions[scope].description}
                </p>
              </li>
            ))}
        </ul>
      </div>

      {
        <OAuthConsentForm
          requiresTeamAdmin={requiresTeamAdmin}
          memberships={memberships}
          defaultTeamId={defaultTeamId}
        >
          <HiddenAuthorizationFields input={input} />
        </OAuthConsentForm>
      }

      <form action={denyMcpOAuthAction}>
        <HiddenAuthorizationFields input={input} />
        <Button type="submit" variant="outline" className="w-full">
          Deny access
        </Button>
      </form>

      <p className="text-xs leading-5 text-fg-muted">
        The app receives content returned from the team and scopes you approve and may process or
        retain it under its own terms and privacy policy. Revoking access from Connect your agent
        stops future Timeline requests but does not delete information the app already received.
        Timeline never sends your password to this app. Review Timeline&apos;s{' '}
        <Link href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>{' '}
        and{' '}
        <Link href="/terms" className="text-primary hover:underline">
          Terms of Use
        </Link>
        .
      </p>
    </AuthShell>
  );
}
