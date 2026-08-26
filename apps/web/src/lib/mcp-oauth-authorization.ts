export interface McpAuthorizationInput {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
}

export type McpAuthorizationSearchParams = Record<string, string | string[] | undefined>;

export const MCP_AUTHORIZATION_NOTICES = {
  invalidTeam: 'invalid_team',
  requestFailed: 'request_failed',
} as const;

export type McpAuthorizationNotice =
  (typeof MCP_AUTHORIZATION_NOTICES)[keyof typeof MCP_AUTHORIZATION_NOTICES];

const parameterNames = {
  responseType: 'response_type',
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  scope: 'scope',
  state: 'state',
  codeChallenge: 'code_challenge',
  codeChallengeMethod: 'code_challenge_method',
  resource: 'resource',
} as const;

function searchValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function authorizationInputFromSearchParams(
  params: McpAuthorizationSearchParams,
): McpAuthorizationInput {
  return {
    responseType: searchValue(params.response_type),
    clientId: searchValue(params.client_id),
    redirectUri: searchValue(params.redirect_uri),
    scope: searchValue(params.scope),
    state: searchValue(params.state),
    codeChallenge: searchValue(params.code_challenge),
    codeChallengeMethod: searchValue(params.code_challenge_method),
    resource: searchValue(params.resource),
  };
}

export function authorizationInputFromFormData(formData: FormData): McpAuthorizationInput {
  const read = (name: string): string | null => {
    const values = formData.getAll(name);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
  };
  return {
    responseType: read(parameterNames.responseType),
    clientId: read(parameterNames.clientId),
    redirectUri: read(parameterNames.redirectUri),
    scope: read(parameterNames.scope),
    state: read(parameterNames.state),
    codeChallenge: read(parameterNames.codeChallenge),
    codeChallengeMethod: read(parameterNames.codeChallengeMethod),
    resource: read(parameterNames.resource),
  };
}

export function mcpAuthorizationNoticeFromSearchParam(
  value: string | string[] | undefined,
): McpAuthorizationNotice | null {
  if (typeof value !== 'string') return null;
  return Object.values(MCP_AUTHORIZATION_NOTICES).includes(value as McpAuthorizationNotice)
    ? (value as McpAuthorizationNotice)
    : null;
}

export function mcpAuthorizationPath(
  input: McpAuthorizationInput,
  notice?: McpAuthorizationNotice,
): string {
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(parameterNames) as [
    keyof McpAuthorizationInput,
    string,
  ][]) {
    const value = input[key];
    if (value !== null) params.set(name, value);
  }
  if (notice) params.set('consent_error', notice);
  return `/oauth/authorize?${params.toString()}`;
}

export function mcpAuthorizationLegalAcceptancePath(input: McpAuthorizationInput): string {
  return `/legal/accept?returnTo=${encodeURIComponent(mcpAuthorizationPath(input))}`;
}

export function authorizationHiddenFields(input: McpAuthorizationInput) {
  return (Object.entries(parameterNames) as [keyof McpAuthorizationInput, string][]).map(
    ([key, name]) => ({ name, value: input[key] ?? '' }),
  );
}
