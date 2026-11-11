import Link from 'next/link';

import type { DirectoryOptions } from '@timeline/shared/platform-admin';

export function AdminSearch({
  query,
  options = {},
  kind = 'teams',
}: {
  query: string;
  options?: DirectoryOptions;
  kind?: 'teams' | 'users' | 'audit';
}) {
  const { statuses, sorts } = directoryChoices(kind);
  const field = 'min-h-11 rounded-sm border border-border bg-bg px-3 text-sm';
  return (
    <form className="flex flex-wrap items-end gap-3">
      {options.team && <input type="hidden" name="team" value={options.team} />}
      <label className="flex-1 text-sm">
        Search
        <input
          aria-label={kind === 'audit' ? 'Search actions' : 'Search by name, email, slug, or ID'}
          name="q"
          defaultValue={query}
          placeholder={kind === 'audit' ? 'Action' : 'Name, email, slug, or ID'}
          maxLength={200}
          className={`${field} block w-full`}
        />
      </label>
      {kind !== 'audit' && (
        <label className="text-sm">
          Status
          <select name="status" defaultValue={options.status ?? ''} className={`${field} block`}>
            <option value="">All</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'teams' && (
        <label className="text-sm">
          Plan
          <select name="plan" defaultValue={options.plan ?? ''} className={`${field} block`}>
            <option value="">All plans</option>
            {['free', 'payg', 'team', 'business', 'enterprise'].map((plan) => (
              <option key={plan}>{plan}</option>
            ))}
          </select>
        </label>
      )}
      {kind === 'audit' && (
        <label className="text-sm">
          Actor
          <input name="actor" defaultValue={options.actor ?? ''} className={`${field} block`} />
        </label>
      )}
      <label className="text-sm">
        Sort
        <select name="sort" defaultValue={options.sort ?? 'created'} className={`${field} block`}>
          {sorts.map((sort) => (
            <option key={sort}>{sort}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Direction
        <select
          name="direction"
          defaultValue={options.direction ?? 'desc'}
          className={`${field} block`}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
      <label className="text-sm">
        From
        <input
          type="date"
          name="from"
          defaultValue={options.from ?? ''}
          className={`${field} block`}
        />
      </label>
      <label className="text-sm">
        Through
        <input type="date" name="to" defaultValue={options.to ?? ''} className={`${field} block`} />
      </label>
      <button type="submit" className={field}>
        Search
      </button>
    </form>
  );
}
export function AdminPagination({
  page,
  hasNext,
  query = '',
  options = {},
}: {
  page: number;
  hasNext: boolean;
  query?: string;
  options?: DirectoryOptions;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({ q: query, page: String(page) });
    for (const [key, value] of Object.entries(options))
      if (typeof value === 'string' && value && key !== 'page' && key !== 'q')
        params.set(key, value);
    return `?${params}`;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center gap-4 text-sm">
      {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
      <span>Page {page}</span>
      {hasNext && <Link href={href(page + 1)}>Next</Link>}
    </nav>
  );
}

export function AdminMembershipFilters({ options }: { options: DirectoryOptions }) {
  const field = 'min-h-11 rounded-sm border border-border bg-bg px-3 text-sm';
  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        Role
        <select name="role" defaultValue={options.role ?? ''} className={`${field} block`}>
          <option value="">All roles</option>
          {['owner', 'admin', 'member'].map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Membership
        <select name="status" defaultValue={options.status ?? ''} className={`${field} block`}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="removed">Removed</option>
        </select>
      </label>
      <label className="text-sm">
        Sort
        <select name="sort" defaultValue={options.sort ?? 'name'} className={`${field} block`}>
          {['name', 'role', 'created'].map((sort) => (
            <option key={sort}>{sort}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Direction
        <select
          name="direction"
          defaultValue={options.direction ?? 'asc'}
          className={`${field} block`}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      <label>
        From
        <input type="date" name="from" defaultValue={options.from} className={field} />
      </label>
      <label>
        Through
        <input type="date" name="to" defaultValue={options.to} className={field} />
      </label>
      <button type="submit" className={field}>
        Apply
      </button>
    </form>
  );
}

function directoryChoices(kind: 'teams' | 'users' | 'audit') {
  const statuses =
    kind === 'teams'
      ? ['active', 'disabled', 'requested', 'deleting', 'deleted']
      : ['active', 'disabled', 'unverified'];
  const sorts =
    kind === 'audit'
      ? ['created', 'action', 'actor']
      : kind === 'teams'
        ? ['created', 'name', 'disabled', 'requested']
        : ['created', 'name', 'email', 'disabled'];
  return { statuses, sorts };
}
