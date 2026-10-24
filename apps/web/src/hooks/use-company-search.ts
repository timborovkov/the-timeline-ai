'use client';

import { useCallback, useEffect, useReducer } from 'react';

import { searchObjectsAction } from '@/app/actions/objects';

export interface CompanyOption {
  id: string;
  label: string;
}

export type CompanySearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface CompanySearchState {
  query: string;
  companies: CompanyOption[];
  requestId: number;
  status: CompanySearchStatus;
}

type CompanySearchAction =
  | { type: 'queryChanged'; query: string }
  | { type: 'retry' }
  | { type: 'requestSucceeded'; requestId: number; companies: CompanyOption[] }
  | { type: 'requestFailed'; requestId: number };

const initialState: CompanySearchState = {
  query: '',
  companies: [],
  requestId: 0,
  status: 'idle',
};

function companySearchReducer(
  state: CompanySearchState,
  action: CompanySearchAction,
): CompanySearchState {
  switch (action.type) {
    case 'queryChanged':
      return beginSearch(state, action.query);
    case 'retry':
      return beginSearch(state, state.query);
    case 'requestSucceeded':
      return action.requestId === state.requestId
        ? { ...state, companies: action.companies, status: 'success' }
        : state;
    case 'requestFailed':
      return action.requestId === state.requestId
        ? { ...state, companies: [], status: 'error' }
        : state;
  }
}

function beginSearch(state: CompanySearchState, query: string): CompanySearchState {
  return {
    query,
    companies: [],
    requestId: state.requestId + 1,
    status: query.trim().length < 2 ? 'idle' : 'loading',
  };
}

export function useCompanySearch(): {
  query: string;
  setQuery: (query: string) => void;
  companies: CompanyOption[];
  status: CompanySearchStatus;
  retry: () => void;
} {
  const [state, dispatch] = useReducer(companySearchReducer, initialState);

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
      void searchObjectsAction({ query: normalized, type: 'company' })
        .then((result) => {
          if (!active) return;
          dispatch({
            type: 'requestSucceeded',
            requestId,
            companies: result.results.flatMap((row) =>
              row.type === 'company' ? [{ id: row.id, label: row.canonicalName }] : [],
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
    companies: state.companies,
    status: state.status,
    retry,
  };
}
