import { CopyableTextField } from '@/components/copyable-text-field';

export function TeamSupportMetadata({ teamId, teamSlug }: { teamId: string; teamSlug: string }) {
  return (
    <div className="space-y-3">
      <CopyableTextField id="team-id" label="Team id" value={teamId} copyLabel="Copy team id" />
      <CopyableTextField
        id="team-slug"
        label="Team slug"
        value={teamSlug}
        copyLabel="Copy team slug"
        description="Support uses these to find the workspace. They cannot be edited here."
      />
    </div>
  );
}
