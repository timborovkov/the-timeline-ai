'use client';

import Link from 'next/link';

import { PublicSessionBranch } from '@/components/public-session-branch';
import { Button } from '@/components/ui/button';

interface HelpAppLinkProps {
  href: string;
  label: string;
}

export function HelpAppLink({ href, label }: HelpAppLinkProps) {
  const callbackUrl = `/sign-in?callbackUrl=${encodeURIComponent(href)}`;
  return (
    <PublicSessionBranch
      signedIn={
        <Button asChild size="sm">
          <Link href={href}>{label}</Link>
        </Button>
      }
      signedOut={
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={callbackUrl}>Sign in to open</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/sign-up">Create account</Link>
          </Button>
        </div>
      }
    />
  );
}
