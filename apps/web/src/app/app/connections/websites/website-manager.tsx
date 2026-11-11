'use client';
import { ArrowUpRight, Globe, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

interface Website {
  id: string;
  url: string;
  subject: string;
  paused: boolean;
  blockedReason: string | null;
  nextScanAt: string | null;
  schedule: {
    frequency: 'manual' | 'daily' | 'weekly';
    time: string;
    weekday: number;
    timezone: string;
  };
}
interface Run {
  id: string;
  status: string;
  pageCount: number;
  changedCount: number;
  sourceUnits: number;
  createdAt: string;
  failureReason: string | null;
}
async function request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/websites${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method === 'POST' && path.endsWith('/scans')
        ? { 'idempotency-key': crypto.randomUUID() }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === 'object' && result !== null && 'error' in result ? result.error : null;
    throw new Error(typeof message === 'string' ? message : 'Website request failed');
  }
  return result as T;
}
export function WebsiteManager({
  canManage,
  timezone,
  schedulesEnabled,
  initialSourceId,
}: {
  canManage: boolean;
  timezone: string;
  schedulesEnabled: boolean;
  initialSourceId?: string;
}) {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [error, setError] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialSourceId ?? null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const refresh = useCallback(async () => {
    const data = await request<{ websites: Website[] }>('');
    setWebsites(data.websites);
    setLoading(false);
    setError('');
  }, []);
  const selectedWebsiteExists = websites.some((website) => website.id === selected);
  useEffect(() => {
    if (!selected || !selectedWebsiteExists) return;
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await request<{ runs: Run[] }>(`/${selected}`);
        if (active) setRuns(data.runs);
      } catch {
        if (active) setError('Could not refresh scan history. Try again.');
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected, selectedWebsiteExists]);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (active)
        void refresh().catch(() => {
          if (active) {
            setLoading(false);
            setError('Could not refresh websites. Try again.');
          }
        });
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await notifyAction({
        id: 'website-action',
        loading: 'Updating website…',
        success,
        error: 'Could not update this website. Check the settings and try again.',
        run: async () => {
          await fn();
          await refresh();
          return { ok: true };
        },
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Websites"
        subtitle="Follow public websites. Keep the changes."
        leading={
          <Link href="/app/connections/sources" className="text-sm text-fg-muted hover:text-fg">
            ← Sources
          </Link>
        }
        trailing={
          <Button
            ref={addButton}
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add website
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <span>
          {websites.length} {websites.length === 1 ? 'website' : 'websites'} · Visible to your team
        </span>
        <Link href="/integrations/websites" className="underline underline-offset-4">
          How scanning works
        </Link>
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {error}
          <Button
            variant="outline"
            onClick={() =>
              void refresh().catch(() => {
                setError('Could not load websites. Try again.');
              })
            }
          >
            Try again
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status" className="border-y py-10 text-sm text-fg-muted">
          Loading websites…
        </p>
      ) : websites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Your websites, kept current"
          body="Add your company’s website or another public site to start collecting changes."
        />
      ) : (
        <div className="divide-y border-y">
          {websites.map((website) => (
            <section key={website.id} className="py-5">
              <div className="flex flex-wrap items-center gap-4">
                <Globe aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1 basis-48">
                  <h2 className="break-all text-base font-semibold">
                    {website.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </h2>
                  <p className="mt-1 text-sm text-fg-muted">
                    {website.subject === 'own_team' ? 'Your company' : 'Another company'} ·{' '}
                    {website.paused
                      ? 'Paused'
                      : website.schedule.frequency === 'manual'
                        ? 'On demand'
                        : `${website.schedule.frequency === 'daily' ? 'Daily' : 'Weekly'} · ${website.schedule.time} ${website.schedule.timezone}`}
                  </p>
                </div>
                {website.blockedReason && <StatusBadge status="blocked" />}
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    disabled={busy || website.paused}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Scan up to five public pages for up to 100 source units? Confirm you have permission to submit this website.',
                        )
                      )
                        void act(
                          () =>
                            request(`/${website.id}/scans`, 'POST', { permissionConfirmed: true }),
                          'Scan queued',
                        );
                    }}
                  >
                    <RefreshCw aria-hidden="true" />
                    Scan now
                  </Button>
                  <Button
                    variant="ghost"
                    aria-expanded={selected === website.id}
                    onClick={() => {
                      setRuns(null);
                      setSelected(selected === website.id ? null : website.id);
                    }}
                  >
                    History
                  </Button>
                </div>
              </div>
              {website.blockedReason && (
                <p className="mt-3 text-sm text-destructive">
                  Scanning is blocked. Check{' '}
                  <Link className="underline" href="/app/team?section=billing">
                    billing
                  </Link>{' '}
                  and source settings before retrying.
                </p>
              )}
              {canManage && (
                <details className="mt-3 sm:ml-9">
                  <summary className="w-fit cursor-pointer rounded-sm text-sm text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
                    Schedule & settings
                  </summary>
                  <div className="mt-4 space-y-4 border-l pl-4">
                    <WebsiteSchedule
                      key={JSON.stringify(website.schedule)}
                      website={website}
                      timezone={timezone}
                      enabled={schedulesEnabled}
                      busy={busy}
                      save={(schedule) =>
                        act(
                          () => request(`/${website.id}`, 'PATCH', { schedule }),
                          'Schedule saved',
                        )
                      }
                    />
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => request(`/${website.id}`, 'PATCH', { paused: !website.paused }),
                            website.paused ? 'Website resumed' : 'Website paused',
                          )
                        }
                      >
                        {website.paused ? 'Resume scans' : 'Pause scans'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Remove this source and stop future scans? Captured history will remain.',
                            )
                          )
                            void act(async () => {
                              await request(`/${website.id}`, 'DELETE');
                              if (selected === website.id) setSelected(null);
                            }, 'Website removed');
                        }}
                      >
                        Remove website
                      </Button>
                    </div>
                  </div>
                </details>
              )}
              {selected === website.id && <WebsiteHistory runs={runs} timezone={timezone} />}
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-fg-muted">Up to 5 pages per scan · 20 source units per page</p>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            addButton.current?.focus();
          }}
          className="max-h-[90dvh] overflow-y-auto overscroll-contain"
        >
          <DialogHeader>
            <DialogTitle>Add a website</DialogTitle>
            <DialogDescription>Capture public pages and follow what changes.</DialogDescription>
          </DialogHeader>
          <AddWebsiteForm
            busy={busy}
            cancel={() => {
              setAdding(false);
            }}
            add={async (data) => {
              await act(async () => {
                await request('', 'POST', {
                  url: data.get('url'),
                  subject: data.get('subject'),
                  permissionConfirmed: data.get('permission') === 'on',
                });
                setAdding(false);
              }, 'Website added');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebsiteSchedule({
  website,
  timezone,
  enabled,
  busy,
  save,
}: {
  website: Website;
  timezone: string;
  enabled: boolean;
  busy: boolean;
  save: (schedule: Website['schedule']) => Promise<void>;
}) {
  const [draftFrequency, setFrequency] = useState<Website['schedule']['frequency'] | null>(null);
  const frequency = draftFrequency ?? website.schedule.frequency;
  return (
    <form
      className="space-y-4"
      action={async (data) => {
        await save({
          frequency,
          time: (data.get('time') as string | null) ?? website.schedule.time,
          weekday: Number(data.get('weekday') ?? website.schedule.weekday),
          timezone: (data.get('timezone') as string | null) ?? website.schedule.timezone,
        });
      }}
    >
      <div className="grid max-w-2xl grid-cols-1 items-end gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-sm">
          <span>Scan frequency</span>
          <NativeSelect
            value={frequency}
            onChange={(event) => {
              setFrequency(event.target.value as Website['schedule']['frequency']);
            }}
          >
            <option value="manual">On demand</option>
            <option value="daily" disabled={!enabled}>
              Daily
            </option>
            <option value="weekly" disabled={!enabled}>
              Weekly
            </option>
          </NativeSelect>
        </label>
        {frequency !== 'manual' && (
          <>
            <label className="space-y-1.5 text-sm">
              <span>Local time</span>
              <Input name="time" type="time" defaultValue={website.schedule.time} required />
            </label>
            {frequency === 'weekly' && (
              <label className="space-y-1.5 text-sm">
                <span>Day</span>
                <NativeSelect name="weekday" defaultValue={website.schedule.weekday}>
                  {[
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday',
                  ].map((day, i) => (
                    <option key={day} value={i + 1}>
                      {day}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <label className="space-y-1.5 text-sm">
              <span>Timezone</span>
              <Input
                name="timezone"
                defaultValue={
                  website.schedule.frequency === 'manual' ? timezone : website.schedule.timezone
                }
                required
              />
            </label>
          </>
        )}
      </div>
      {!enabled && (
        <p className="text-xs text-fg-muted">
          Scheduled scans aren’t enabled yet. You can scan on demand.
        </p>
      )}
      <Button variant="outline" disabled={busy}>
        Save schedule
      </Button>
    </form>
  );
}

function AddWebsiteForm({
  busy,
  add,
  cancel,
}: {
  busy: boolean;
  add: (data: FormData) => Promise<void>;
  cancel: () => void;
}) {
  return (
    <form className="space-y-5" action={add}>
      <label className="block space-y-2 text-sm font-medium">
        <span>Website URL</span>
        <Input name="url" type="url" required placeholder="https://example.com" />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        <span>Who is it about?</span>
        <NativeSelect name="subject">
          <option value="own_team">Our company</option>
          <option value="other_company">Another company</option>
        </NativeSelect>
      </label>
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          name="permission"
          type="checkbox"
          className="mt-1.5 size-4 shrink-0 accent-primary"
          required
        />
        I have permission to submit this website and its public content for scanning.
      </label>
      <p className="text-xs leading-5 text-fg-muted">
        Adding is free. Scans use 20 source units per captured page, including unchanged pages. Up
        to 100 units per scan; AI and storage are additional.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            cancel();
          }}
        >
          Cancel
        </Button>
        <Button disabled={busy} type="submit">
          Add website
        </Button>
      </div>
    </form>
  );
}

function WebsiteHistory({ runs, timezone }: { runs: Run[] | null; timezone: string }) {
  return (
    <div className="mt-5 border-t pt-4 sm:ml-9">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Scan history</h3>
        <span className="text-xs text-fg-muted">{timezone}</span>
      </div>
      {runs === null ? (
        <p role="status" className="text-sm text-fg-muted">
          Loading scan history…
        </p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-fg-muted">No scans to show yet.</p>
      ) : (
        <ul className="divide-y">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
              <div className="min-w-0 flex-1 basis-52">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={run.status} />
                  <RelativeTimestamp value={run.createdAt} />
                </div>
                <p className="mt-2 text-fg-muted">
                  {run.pageCount} pages ·{' '}
                  {run.changedCount === 0 ? 'No changes' : `${run.changedCount} changed`}
                </p>
                {run.failureReason && (
                  <p className="mt-1 text-destructive">
                    Scan needs attention. Check settings and billing before retrying.
                  </p>
                )}
              </div>
              <span className="text-xs tabular-nums text-fg-muted">{run.sourceUnits} units</span>
              {run.changedCount > 0 && (
                <Link
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                  href={`/app/timeline?moment=${encodeURIComponent(`moment:website:${run.id}`)}`}
                >
                  View changes
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
