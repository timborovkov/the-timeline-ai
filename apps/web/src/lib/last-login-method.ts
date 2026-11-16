import { cookies } from 'next/headers';

export type LoginMethod = 'google' | 'github' | 'credentials';

const COOKIE_NAME = 'tl_last_login_method';

function loginMethod(value: string | undefined): LoginMethod | null {
  return value === 'google' || value === 'github' || value === 'credentials' ? value : null;
}

export async function readLastLoginMethod(): Promise<LoginMethod | null> {
  return loginMethod((await cookies()).get(COOKIE_NAME)?.value);
}

/** Called only by Auth.js's successful sign-in event, including OAuth callbacks. */
export async function rememberLastLoginMethod(provider: string | undefined): Promise<void> {
  const method = loginMethod(provider);
  if (!method) return;
  (await cookies()).set(COOKIE_NAME, method, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
}
