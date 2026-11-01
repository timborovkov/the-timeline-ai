import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

export function getSupportEmail(): string {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return email === '' ? DEFAULT_SUPPORT_EMAIL : (email ?? DEFAULT_SUPPORT_EMAIL);
}
