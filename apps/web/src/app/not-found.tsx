import { RootNotFoundContent } from '@/app/_root-not-found-content';
import { PublicShell } from '@/components/public-shell';
import { auth } from '@/lib/auth';

export default async function NotFound() {
  const session = await auth();

  return (
    <PublicShell isSignedIn={Boolean(session?.user)} footerLabel="The Timeline">
      <RootNotFoundContent />
    </PublicShell>
  );
}
