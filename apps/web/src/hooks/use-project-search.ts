'use client';

import { useEffect, useState } from 'react';

import { searchObjectsAction } from '@/app/actions/objects';

export interface ProjectOption {
  id: string;
  label: string;
}

export function useProjectSearch(): {
  query: string;
  setQuery: (query: string) => void;
  projects: ProjectOption[];
} {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setProjects([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void searchObjectsAction({ query: normalized, type: 'project' }).then((result) => {
        if (!active) return;
        setProjects(
          result.results.flatMap((row) =>
            row.type === 'project' ? [{ id: row.id, label: row.canonicalName }] : [],
          ),
        );
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return { query, setQuery, projects };
}
