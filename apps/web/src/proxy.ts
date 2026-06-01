import NextAuth from 'next-auth';

import { authConfig } from '@/lib/auth.config';

export const proxy = NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
