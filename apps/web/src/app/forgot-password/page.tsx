import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth-shell';
import { ForgotPasswordForm } from '@/components/password-recovery-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="We’ll email you a link to choose a new password."
      secondaryPrefix="Remember your password?"
      secondaryHref="/sign-in"
      secondaryLabel="Sign in"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
