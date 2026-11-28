import type { NextRequest } from 'next/server';

import { handlers } from '@/lib/auth';
import {
  GITHUB_LINK_FAILED,
  githubAuthUrl,
  hasGitHubLinkReturn,
  isGitHubCallback,
} from '@/lib/github-login-link';

export const { POST } = handlers;

export async function GET(request: NextRequest) {
  const response = await handlers.GET(request);
  if (!isGitHubCallback(request) || !hasGitHubLinkReturn(request)) return response;

  const location = response.headers.get('location');
  if (!location) return response;
  const target = new URL(location, request.url);
  if (
    target.origin !== githubAuthUrl(request).origin ||
    !['/sign-in', '/api/auth/signin', '/api/auth/error'].includes(target.pathname)
  ) {
    return response;
  }
  // Auth.js uses its global sign-in/error pages for a cancelled or failed callback.
  const headers = new Headers(response.headers);
  headers.set('location', new URL(GITHUB_LINK_FAILED, target.origin).href);
  return new Response(response.body, { status: response.status, headers });
}
