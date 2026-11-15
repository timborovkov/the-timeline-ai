import {
  EVALUATION_SOURCE_LABELS,
  EVALUATION_SOURCES,
} from '@timeline/shared/evaluation-tracing/contract';

import { evaluationSharingStatus } from '@/lib/workspace-sharing-status';

export function PlatformWorkspaceSharing({
  preference,
  reportsEnabled,
  available,
  inactive,
}: {
  preference: { enabled: boolean; sources: string[]; policyVersion: string };
  reportsEnabled: boolean;
  available: boolean;
  inactive: boolean;
}) {
  const selectedSources = new Set(preference.sources);
  const sources = EVALUATION_SOURCES.filter((source) => selectedSources.has(source)).map(
    (source) => EVALUATION_SOURCE_LABELS[source],
  );
  return (
    <section
      className="space-y-3 border-t border-border pt-5"
      aria-labelledby="workspace-sharing-title"
    >
      <h2 id="workspace-sharing-title" className="font-semibold">
        Quality and support sharing
      </h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Evaluation tracing</dt>
          <dd>{evaluationSharingStatus(preference, available, inactive)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Conversation report permission</dt>
          <dd>
            {reportsEnabled ? 'Enabled — each report needs member consent' : 'Disabled'}
            {reportsEnabled && inactive ? ' · submissions paused' : ''}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Selected sources</dt>
          <dd>{sources.join(', ') || 'None'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Evaluation consent version</dt>
          <dd>{preference.policyVersion || 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Capture configuration on this web instance</dt>
          <dd>{available ? 'Ready' : 'Not ready'}</dd>
        </div>
      </dl>
      <p className="text-xs leading-5 text-fg-muted">
        These are saved permissions and configuration, not proof that traces have been received. The
        worker must also be configured. Only workspace owners and admins can change opt-in; platform
        access does not grant consent.
      </p>
    </section>
  );
}
