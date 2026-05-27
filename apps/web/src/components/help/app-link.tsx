import Link from 'next/link';

import { Button } from '@/components/ui/button';

interface HelpAppLinkProps {
  href: string;
  label: string;
  isSignedIn: boolean;
}

export function HelpAppLink({ href, label, isSignedIn }: HelpAppLinkProps) {
  if (isSignedIn) {
    return (
      <Button asChild size="sm">
        <Link href={href}>{label}</Link>
      </Button>
    );
  }

  const callbackUrl = `/sign-in?callbackUrl=${encodeURIComponent(href)}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm">
        <Link href={callbackUrl}>Sign in to open</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href="/sign-up">Create account</Link>
      </Button>
    </div>
  );
}
