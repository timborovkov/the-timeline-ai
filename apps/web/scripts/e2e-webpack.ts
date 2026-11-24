import { relative } from 'node:path';

type SplitChunks = false | { cacheGroups?: Record<string, unknown> };

interface WorkspaceModule {
  layer?: string | null;
  nameForCondition(): string | null;
}

export function e2eServerSplitChunks(
  splitChunks: SplitChunks | undefined,
  workspaceRoot: string,
): SplitChunks {
  if (!splitChunks || !splitChunks.cacheGroups?.vendor) {
    throw new Error('Next development server chunk groups changed; review the E2E compiler.');
  }
  return {
    ...splitChunks,
    cacheGroups: {
      ...splitChunks.cacheGroups,
      timelineWorkspace: {
        chunks: 'all',
        enforce: true,
        reuseExistingChunk: true,
        test(module: WorkspaceModule) {
          const path = module.nameForCondition();
          return (
            path !== null &&
            /^packages[\\/](?:db|shared)[\\/](?:src|dist)[\\/]/.test(relative(workspaceRoot, path))
          );
        },
        // Keep RSC, route-handler and other layer-specific module instances apart.
        name: (module: WorkspaceModule) => `workspace-chunks/${module.layer ?? 'default'}`,
      },
    },
  };
}
