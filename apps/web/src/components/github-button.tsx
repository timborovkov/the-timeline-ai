import { signInWithGitHubAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';

export function GitHubSignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <form action={signInWithGitHubAction}>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <Button type="submit" variant="outline" className="w-full">
        Continue with GitHub
      </Button>
    </form>
  );
}
