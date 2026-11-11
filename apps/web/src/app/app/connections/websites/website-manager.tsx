'use client';
import { useQuery } from '@tanstack/react-query';
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
  DialogFooter,
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
  latestRun: RunSummary | null;
  schedule: {
    frequency: 'manual' | 'daily' | 'weekly';
    time: string;
    weekday: number;
    timezone: string;
  };
}
interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  changedCount: number;
}
function isScanning(run: RunSummary | null | undefined) {
  return Boolean(run && ['queued', 'crawling', 'processing'].includes(run.status));
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
  const refreshVersion = useRef(0);
  const hasActiveScan = websites.some((website) => isScanning(website.latestRun));
  const addButton = useRef<HTMLButtonElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    websiteId: string;
    action: 'scan' | 'remove';
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialSourceId ?? null);
  const historyQuery = useQuery({
    queryKey: ['website-history', selected],
    queryFn: () => request<{ runs: Run[] }>(`/${selected}`),
    enabled: Boolean(selected && websites.some((website) => website.id === selected)),
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const runs = historyQuery.data?.runs ?? null;
  const displayedError =
    error || (historyQuery.isError ? 'Could not refresh scan history. Try again.' : '');
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const data = await request<{ websites: Website[] }>('');
    if (version !== refreshVersion.current) return;
    setWebsites(data.websites);
    setLoading(false);
    setError('');
  }, []);
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
          if (selected) await historyQuery.refetch();
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
      {displayedError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {displayedError}
          <Button
            variant="outline"
            onClick={() =>
              void (async () => {
                await refresh();
                if (selected) await historyQuery.refetch();
              })().catch(() => {
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
                  <WebsiteScanSummary run={website.latestRun} />
                </div>
                {website.blockedReason && <StatusBadge status="blocked" />}
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    disabled={busy || website.paused || hasActiveScan}
                    title={
                      hasActiveScan && !isScanning(website.latestRun)
                        ? 'Another website scan is in progress'
                        : undefined
                    }
                    onClick={(event) => {
                      confirmationTrigger.current = event.currentTarget;
                      setConfirmation({ websiteId: website.id, action: 'scan' });
                    }}
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={
                        isScanning(website.latestRun) ? 'motion-safe:animate-spin' : undefined
                      }
                    />
                    {isScanning(website.latestRun)
                      ? website.latestRun?.status === 'queued'
                        ? 'Scan queued'
                        : 'Scanning…'
                      : 'Scan now'}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-expanded={selected === website.id}
                    onClick={() => {
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
                        onClick={(event) => {
                          confirmationTrigger.current = event.currentTarget;
                          setConfirmation({ websiteId: website.id, action: 'remove' });
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
      <WebsiteConfirmation
        action={confirmation?.action ?? null}
        busy={busy || (confirmation?.action === 'scan' && hasActiveScan)}
        close={() => {
          setConfirmation(null);
        }}
        restoreFocus={() => {
          confirmationTrigger.current?.focus();
        }}
        confirm={() => {
          if (!confirmation || busy || (confirmation.action === 'scan' && hasActiveScan)) return;
          const { websiteId, action } = confirmation;
          setConfirmation(null);
          if (action === 'scan') {
            void act(async () => {
              const { run } = await request<{ run: RunSummary }>(`/${websiteId}/scans`, 'POST', {
                permissionConfirmed: true,
              });
              // Keep the accepted run visible even if the subsequent refresh fails.
              ++refreshVersion.current;
              setWebsites((current) =>
                current.map((website) =>
                  website.id === websiteId ? { ...website, latestRun: run } : website,
                ),
              );
            }, 'Scan queued');
          } else {
            void act(async () => {
              await request(`/${websiteId}`, 'DELETE');
              if (selected === websiteId) setSelected(null);
            }, 'Website removed');
          }
        }}
      />
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

function WebsiteScanSummary({ run }: { run: RunSummary | null }) {
  if (!run) return <p className="mt-2 text-xs text-fg-muted">Not scanned yet</p>;
  const active = isScanning(run);
  const labels: Record<string, string> = {
    queued: 'Queued',
    crawling: 'Scanning website',
    processing: 'Processing pages',
    completed: 'Last scanned',
    partial: 'Last scan partially completed',
    cancelled: 'Last scan cancelled',
    blocked: 'Last scan blocked',
    failed: 'Last scan failed',
  };
  const label = labels[run.status] ?? 'Last scan';
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted"
      role="status"
    >
      <span>
        {label} <RelativeTimestamp value={run.finishedAt ?? run.createdAt} />
      </span>
      {!active && run.status === 'completed' && run.changedCount === 0 && (
        <span>No changes found</span>
      )}
      {!active && run.changedCount > 0 && (
        <Link
          className="underline underline-offset-4"
          href={`/app/timeline?moment=${encodeURIComponent(`moment:website:${run.id}`)}`}
        >
          View changes
        </Link>
      )}
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

function WebsiteConfirmation({
  action,
  busy,
  close,
  confirm,
  restoreFocus,
}: {
  action: 'scan' | 'remove' | null;
  busy: boolean;
  close: () => void;
  confirm: () => void;
  restoreFocus: () => void;
}) {
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{action === 'scan' ? 'Scan website?' : 'Remove website?'}</DialogTitle>
          <DialogDescription>
            {action === 'scan'
              ? 'Scan up to five public pages for up to 100 source units? Confirm you have permission to submit this website.'
              : 'Remove this source and stop future scans? Captured history will remain.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            variant={action === 'remove' ? 'destructive' : 'default'}
            onClick={confirm}
          >
            {action === 'scan' ? 'Confirm scan' : 'Remove website'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
