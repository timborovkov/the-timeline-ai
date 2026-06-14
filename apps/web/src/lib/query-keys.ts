export const queryKeys = {
  timeline: (filters: Record<string, string | null | undefined>) => ['timeline', filters] as const,
  objectSection: (objectId: string, section: string) => ['object', objectId, section] as const,
  objectSearch: (query: string, excludeId: string) =>
    ['objects', 'search', query, excludeId] as const,
  documentList: (folderId: string | null) => ['documents', 'list', folderId] as const,
  documentSearch: (query: string, filters: Record<string, string | null | undefined>) =>
    ['documents', 'search', query, filters] as const,
  providerConnectionResources: (connectionId: string) =>
    ['provider-connections', connectionId, 'resources'] as const,
  jobDashboard: () => ['jobs', 'dashboard'] as const,
  finishedJobs: () => ['jobs', 'finished'] as const,
  onboarding: () => ['onboarding', 'checklist'] as const,
};
