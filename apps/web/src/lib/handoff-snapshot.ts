import type { ArtifactRef } from '@timeline/shared/citation';
import type { TeamScope } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { artifactRefSchema, hydrateArtifactPreview } from '@/lib/artifact-preview';

export const handoffBodySchema = z.object({
  project: z.string(),
  answer: z.string(),
  sources: z.array(artifactRefSchema).min(1).max(100),
  commitments: z
    .array(z.object({ id: z.uuid(), title: z.string(), owner: z.string().nullable() }))
    .max(100),
});

export async function resolveHandoffSources(scope: TeamScope, refs: ArtifactRef[]) {
  const timezone = (await scope.calendar.getCalendarSettings()).defaultTimezone;
  const results = [];
  // Keep high-citation answers from exhausting the database connection pool.
  for (let i = 0; i < refs.length; i += 8) {
    const previews = await Promise.all(
      refs.slice(i, i + 8).map((ref) => hydrateArtifactPreview(scope, scope.teamId, ref, timezone)),
    );
    for (const preview of previews) {
      if (!preview) return null;
      results.push(preview);
    }
  }
  return results;
}
