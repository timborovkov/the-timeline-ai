import { signInWithGitHubAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';

export function GitHubSignInButton({
  callbackUrl,
  inviteToken,
}: {
  callbackUrl?: string;
  inviteToken?: string;
}) {
  return (
    <form action={signInWithGitHubAction}>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      {inviteToken ? <input type="hidden" name="inviteToken" value={inviteToken} /> : null}
      <Button type="submit" variant="outline" className="w-full">
        Continue with GitHub
      </Button>
    </form>
  );
}
