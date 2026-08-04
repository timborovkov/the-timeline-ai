'use client';

import { useCallback, useEffect, useReducer } from 'react';

import { searchObjectsAction } from '@/app/actions/objects';

export interface ProjectOption {
  id: string;
  label: string;
}

export type ProjectSearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface ProjectSearchState {
  query: string;
  projects: ProjectOption[];
  requestId: number;
  status: ProjectSearchStatus;
}

type ProjectSearchAction =
  | { type: 'queryChanged'; query: string }
  | { type: 'retry' }
  | { type: 'requestSucceeded'; requestId: number; projects: ProjectOption[] }
  | { type: 'requestFailed'; requestId: number };

const initialState: ProjectSearchState = {
  query: '',
  projects: [],
  requestId: 0,
  status: 'idle',
};

function projectSearchReducer(
  state: ProjectSearchState,
  action: ProjectSearchAction,
): ProjectSearchState {
  switch (action.type) {
    case 'queryChanged':
      return beginSearch(state, action.query);
    case 'retry':
      return beginSearch(state, state.query);
    case 'requestSucceeded':
      return action.requestId === state.requestId
        ? { ...state, projects: action.projects, status: 'success' }
        : state;
    case 'requestFailed':
      return action.requestId === state.requestId
        ? { ...state, projects: [], status: 'error' }
        : state;
  }
}

function beginSearch(state: ProjectSearchState, query: string): ProjectSearchState {
  return {
    query,
    projects: [],
    requestId: state.requestId + 1,
    status: query.trim().length < 2 ? 'idle' : 'loading',
  };
}

export function useProjectSearch(): {
  query: string;
  setQuery: (query: string) => void;
  projects: ProjectOption[];
  status: ProjectSearchStatus;
  retry: () => void;
} {
  const [state, dispatch] = useReducer(projectSearchReducer, initialState);

  const setQuery = useCallback((query: string) => {
    dispatch({ type: 'queryChanged', query });
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: 'retry' });
  }, []);

  useEffect(() => {
    if (state.status !== 'loading') return;

    const normalized = state.query.trim();
    const requestId = state.requestId;
    let active = true;
    const timer = setTimeout(() => {
      void searchObjectsAction({ query: normalized, type: 'project' })
        .then((result) => {
          if (!active) return;
          dispatch({
            type: 'requestSucceeded',
            requestId,
            projects: result.results.flatMap((row) =>
              row.type === 'project' ? [{ id: row.id, label: row.canonicalName }] : [],
            ),
          });
        })
        .catch(() => {
          if (!active) return;
          dispatch({ type: 'requestFailed', requestId });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state.query, state.requestId, state.status]);

  return {
    query: state.query,
    setQuery,
    projects: state.projects,
    status: state.status,
    retry,
  };
}
