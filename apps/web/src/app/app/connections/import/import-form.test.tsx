import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

import { ImportForm } from '@/app/app/connections/import/import-form';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('previews and confirms Linear issues without requiring a pipeline stage or project', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        revision: 'first-preview',
        rows: [
          {
            key: 'issue:1',
            title: 'Handle renewal',
            action: 'Link to existing',
            reason: 'Same Linear issue ID',
            candidates: [],
          },
        ],
        stages: {},
        lanes: [],
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: 'rule' }));
  vi.stubGlobal('fetch', request);
  const user = userEvent.setup();
  render(
    <ImportForm
      sources={[
        {
          id: 'connection',
          provider: 'linear',
          resource: 'engineering',
          label: 'Engineering',
          settings: null,
        },
      ]}
      boards={[{ id: 'board', name: 'Launch' }]}
      projects={[]}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Confirm and keep in sync' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  expect(await screen.findByText('Same Linear issue ID')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirm and keep in sync' }));
  expect(await screen.findByText(/Import saved/)).toBeTruthy();
  const body = request.mock.calls[1]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected confirmation JSON');
  expect(JSON.parse(body)).toMatchObject({
    action: 'confirm',
    revision: 'first-preview',
    config: {
      integrationId: 'connection',
      resource: 'engineering',
      boardId: 'board',
      issues: true,
      merges: false,
      stageLanes: {},
    },
  });
});
