import type { withTeam } from '@timeline/shared/team-scope';

export async function guidedApprovalItemIds(scope: ReturnType<typeof withTeam>): Promise<string[]> {
  const record = await scope.onboarding.getFirstRunRecord();
  return record?.suggestions.map((item) => item.id) ?? [];
}
