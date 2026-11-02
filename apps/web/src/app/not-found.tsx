import { RootNotFoundContent } from '@/app/_root-not-found-content';
import { PublicShell } from '@/components/public-shell';

export default function NotFound() {
  return (
    <PublicShell footerLabel="The Timeline">
      <RootNotFoundContent />
    </PublicShell>
  );
}
