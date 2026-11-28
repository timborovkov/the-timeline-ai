'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

interface Option {
  id: string;
  name: string;
}
interface Source {
  id: string;
  provider: string;
  resource: string;
  label: string | null;
  settings: {
    boardId: string;
    projectId: string | null;
    issues: boolean;
    merges: boolean;
    history: boolean;
    stageLanes: Record<string, string>;
  } | null;
}
const option = z.object({ id: z.string(), name: z.string() });
const previewResponse = z.object({
  revision: z.string(),
  stages: z.record(z.string(), z.string()),
  lanes: z.array(option),
  rows: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      action: z.string(),
      reason: z.string(),
      candidates: z.array(option),
    }),
  ),
});
type Preview = z.infer<typeof previewResponse>;
export function ImportForm({
  sources,
  boards,
  projects,
}: {
  sources: Source[];
  boards: Option[];
  projects: Option[];
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source || !boards.length)
    return (
      <p>
        {source
          ? 'Create a destination board to import into.'
          : 'Activate a GitHub repository, Linear team, or HubSpot pipeline for team capture first.'}{' '}
        <Link href={source ? '/app/boards' : '/app/connections/sources'}>
          {source ? 'Open boards' : 'Open shared sources'}
        </Link>
      </p>
    );
  return (
    <div className="space-y-5">
      <label className="block">
        Source
        <NativeSelect
          value={sourceIndex}
          onChange={(e) => {
            setSourceIndex(Number(e.target.value));
          }}
        >
          {sources.map((s, i) => (
            <option key={s.id + s.resource} value={i}>
              {s.label ?? s.resource}
              {s.settings ? ' · syncing' : ''}
            </option>
          ))}
        </NativeSelect>
      </label>
      <SourceImport
        key={source.id + source.resource}
        source={source}
        boards={boards}
        projects={projects}
      />
    </div>
  );
}
function SourceImport({
  source,
  boards,
  projects,
}: {
  source: Source;
  boards: Option[];
  projects: Option[];
}) {
  const [settings, setSettings] = useState(
    () =>
      source.settings ?? {
        boardId: boards[0]?.id ?? '',
        projectId: null,
        issues: true,
        merges: false,
        history: false,
        stageLanes: {},
      },
  );
  const { boardId, projectId, issues, merges, history, stageLanes: mapping } = settings;
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const git = source.provider === 'github';
  const config = importConfig(source, settings);
  const key = JSON.stringify(config);
  const canConfirm = preview && reviewed === key;
  async function submit(action: 'preview' | 'confirm') {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/team/board-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, config, revision: preview?.revision, choices }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const result = z.object({ error: z.string() }).safeParse(data);
        throw new Error(result.success ? result.data.error : 'Could not load import.');
      }
      if (action === 'preview') {
        setPreview(previewResponse.parse(data));
        setReviewed(key);
        setChoices({});
      } else {
        setPreview(null);
        setReviewed('');
        setNotice('Import saved. Future changes from this source will sync to the board.');
      }
    } catch (error) {
      setReviewed('');
      setNotice(error instanceof Error ? error.message : 'Could not load import.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">
          Destination board
          <NativeSelect
            disabled={Boolean(source.settings)}
            value={boardId}
            onChange={(e) => {
              setSettings({ ...settings, boardId: e.target.value, stageLanes: {} });
              setPreview(null);
            }}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {git ? (
          <div className="space-y-3">
            <label className="block">
              <input
                type="checkbox"
                checked={issues}
                onChange={(e) => {
                  setSettings({ ...settings, issues: e.target.checked });
                }}
              />{' '}
              Import issues as tasks and sync their status
            </label>
            <label className="block">
              <input
                type="checkbox"
                checked={merges}
                onChange={(e) => {
                  setSettings({ ...settings, merges: e.target.checked });
                }}
              />{' '}
              Track merged PRs as completed work
            </label>
            {merges && (
              <>
                <label className="block">
                  Project for completed work
                  <NativeSelect
                    value={projectId ?? ''}
                    onChange={(e) => {
                      setSettings({ ...settings, projectId: e.target.value });
                    }}
                  >
                    <option value="">Choose a project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={history}
                    onChange={(e) => {
                      setSettings({ ...settings, history: e.target.checked });
                    }}
                  />{' '}
                  Include past merges
                </label>
              </>
            )}
          </div>
        ) : source.provider === 'linear' ? (
          <p>
            Preview this team’s issues and their matching tasks. After confirmation, Linear will
            control the linked tasks’ status.
          </p>
        ) : (
          <p>
            Preview the pipeline, choose a lane for each stage, then preview your matches. Future
            stage changes in HubSpot will move the linked cards here.
          </p>
        )}
        {preview &&
          source.provider === 'hubspot' &&
          Object.entries(preview.stages).map(([id, label]) => (
            <label key={id} className="block">
              {label}
              <NativeSelect
                value={mapping[id] ?? ''}
                onChange={(e) => {
                  const stageLanes = Object.fromEntries(
                    Object.entries({ ...mapping, [id]: e.target.value }).filter(
                      ([, lane]) => lane.length > 0,
                    ),
                  );
                  setSettings({ ...settings, stageLanes });
                }}
              >
                <option value="">Choose a destination lane</option>
                {preview.lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ))}
        <Button
          type="button"
          variant="outline"
          disabled={busy || (git && ((!issues && !merges) || (merges && !projectId)))}
          onClick={() => void submit('preview')}
        >
          Preview import
        </Button>
        {canConfirm && (
          <ImportReview
            preview={preview}
            pipeline={source.provider === 'hubspot'}
            mapping={mapping}
            choices={choices}
            setChoices={setChoices}
            confirm={() => void submit('confirm')}
          />
        )}
      </fieldset>
      <p role="status">{busy ? 'Working…' : notice}</p>
    </div>
  );
}

function importConfig(source: Source, settings: NonNullable<Source['settings']>) {
  const git = source.provider === 'github';
  return {
    integrationId: source.id,
    resource: source.resource,
    boardId: settings.boardId,
    projectId: git && settings.merges ? settings.projectId : null,
    issues: source.provider === 'linear' || (git && settings.issues),
    merges: git && settings.merges,
    history: git && settings.merges && settings.history,
    stageLanes: source.provider === 'hubspot' ? settings.stageLanes : {},
  };
}
function ImportReview({
  preview,
  pipeline,
  mapping,
  choices,
  setChoices,
  confirm,
}: {
  preview: Preview;
  pipeline: boolean;
  mapping: Record<string, string>;
  choices: Record<string, string>;
  setChoices: (choices: Record<string, string>) => void;
  confirm: () => void;
}) {
  return (
    <div className="space-y-4">
      {['Create', 'Link to existing', 'Review possible matches', 'Skipped'].map((group) => {
        const rows = preview.rows.filter((r) => r.action === group);
        return rows.length ? (
          <section key={group}>
            <h2 className="font-medium">
              {group} ({rows.length})
            </h2>
            <ul>
              {rows.map((row) => (
                <li className="py-1" key={row.key}>
                  {row.title}
                  {row.reason && <span className="ml-2 text-fg-muted">{row.reason}</span>}
                  {row.candidates.length > 0 && (
                    <NativeSelect
                      aria-label={'Match for ' + row.title}
                      value={choices[row.key] ?? ''}
                      onChange={(e) => {
                        setChoices({ ...choices, [row.key]: e.target.value });
                      }}
                    >
                      <option value="">Review later</option>
                      {row.reason === 'Confirm the matching record' && (
                        <option value="create">Create a separate record</option>
                      )}
                      {row.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })}
      {!preview.rows.length && (
        <p>No historical records match these options. Future matching records will sync.</p>
      )}
      {pipeline && !Object.keys(preview.stages).length && (
        <p>Waiting for the first pipeline sync. Preview again once capture finishes.</p>
      )}
      <Button
        type="button"
        disabled={
          pipeline &&
          (!Object.keys(preview.stages).length ||
            Object.keys(preview.stages).some((stage) => !mapping[stage]))
        }
        onClick={confirm}
      >
        Confirm and keep in sync
      </Button>
    </div>
  );
}
