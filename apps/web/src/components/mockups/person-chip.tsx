'use client';

import {
  mockPerson,
  mockProject,
  type MockPerson,
  type MockProject,
  type PersonId,
  type ProjectId,
} from '@/components/mockups/mockup-data';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';

export function PersonChip({ personId, className }: { personId: PersonId; className?: string }) {
  const person = mockPerson(personId);
  return (
    <EntityChip
      className={className}
      label={person.name}
      monogram={initials(person.name)}
      pill
      subtitle={[person.title, person.company].filter(Boolean).join(' · ')}
      title={
        person.kind === 'external' ? 'External person · example data' : 'Teammate · example data'
      }
    />
  );
}

export function ProjectChip({
  projectId,
  className,
}: {
  projectId: ProjectId;
  className?: string;
}) {
  const project = mockProject(projectId);
  return (
    <EntityChip
      className={className}
      label={project.name}
      monogram={initials(project.name)}
      subtitle={projectKindLabel(project)}
      title={`${projectKindLabel(project)} · example data`}
    />
  );
}

export function PersonAvatar({ person, size = 'sm' }: { person: MockPerson; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-border bg-surface-2 font-semibold text-fg',
        size === 'md' ? 'size-8 text-xs' : 'size-5 text-[9px]',
      )}
    >
      {initials(person.name)}
    </span>
  );
}

function EntityChip({
  className,
  label,
  monogram,
  pill = false,
  subtitle,
  title,
}: {
  className?: string;
  label: string;
  monogram: string;
  pill?: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            'mx-0.5 inline-flex items-center gap-1 whitespace-nowrap border border-border bg-surface py-0.5 pl-0.5 pr-1.5 align-middle text-sm font-medium text-fg',
            'transition-colors hover:border-border-strong hover:bg-surface-2',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
            pill ? 'rounded-full' : 'rounded-sm',
            className,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-4 place-items-center bg-surface-2 text-[9px] font-semibold leading-none',
              pill ? 'rounded-full' : 'rounded-sm',
            )}
          >
            {monogram}
          </span>
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-surface p-3 shadow-md"
      >
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
        <p className="mt-2 font-mono text-[11px] text-fg-dim">Example data</p>
      </PopoverContent>
    </Popover>
  );
}

function projectKindLabel(project: MockProject): string {
  if (project.kind === 'company') return 'Company';
  if (project.kind === 'deal') return 'Deal';
  return 'Project';
}
