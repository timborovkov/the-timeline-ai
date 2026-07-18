// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  getDocumentDownloadUrlAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: fakes.back, push: fakes.push, refresh: fakes.refresh }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/actions/documents', () => ({
  deleteDocumentAction: vi.fn(),
  getDocumentDownloadUrlAction: fakes.getDocumentDownloadUrlAction,
  renameDocumentAction: vi.fn(),
}));

const { DocumentDetail } = await import('./document-detail.js');

const SOURCE_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_EVENT_ID = '22222222-2222-4222-8222-222222222222';

function documentSummary(
  overrides: Partial<Parameters<typeof DocumentDetail>[0]['document']> = {},
) {
  return {
    id: 'doc-1',
    fileKind: 'document' as const,
    name: 'Acme launch packet.txt',
    metadata: {},
    folderId: 'folder-1',
    folderPath: 'Documents / Customers / Acme',
    visibility: 'specific_users',
    ownerUserId: 'user-1',
    currentVersionId: 'version-current',
    sourceRawEventId: SOURCE_EVENT_ID,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    provenance: {
      source: 'email',
      sourceEventId: SOURCE_EVENT_ID,
      parentEventId: PARENT_EVENT_ID,
      occurredAt: '2026-07-01T11:45:00.000Z',
      summary: 'Forwarded Acme launch packet from the customer.',
    },
    ...overrides,
  };
}

function versions(
  overrides: Partial<Parameters<typeof DocumentDetail>[0]['versions'][number]>[] = [],
) {
  return [
    {
      id: 'version-current',
      version: 2,
      byteSize: 2048,
      contentType: 'text/plain',
      processingStatus: 'embedded',
      processingError: null,
      createdAt: '2026-07-01T12:00:00.000Z',
      uploadedByUserId: 'user-1',
      ...overrides[0],
    },
    {
      id: 'version-selected',
      version: 1,
      byteSize: 4096,
      contentType: 'application/octet-stream',
      processingStatus: 'chunked',
      processingError: null,
      createdAt: '2026-07-01T10:00:00.000Z',
      uploadedByUserId: 'user-1',
      ...overrides[1],
    },
  ];
}

function renderDetail(overrides: Partial<Parameters<typeof DocumentDetail>[0]> = {}) {
  return render(
    <DocumentDetail
      document={documentSummary()}
      versions={versions()}
      requestedVersion={1}
      activeVersionId="version-selected"
      activeVersionChunks={[
        {
          id: 'chunk-text',
          representationKind: 'source_text',
          text: 'Customer asks for launch readiness, signed terms, and the production Sentry link.',
          summary: null,
          pageNumber: 1,
        },
        {
          id: 'chunk-visual',
          representationKind: 'visual_description',
          text: 'Fallback visual description text.',
          summary: 'Visual summary of the Acme launch packet.',
          pageNumber: 1,
        },
      ]}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.getDocumentDownloadUrlAction.mockResolvedValue({
    ok: true,
    url: 'https://example.test/download/version-selected',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          preview: {
            ref: { kind: 'timeline_event', id: PARENT_EVENT_ID },
            title: 'Customer email',
            subtitle: 'email · Jul 1, 2026',
            body: 'Forwarded Acme launch packet from the customer.',
            href: `/app/timeline?event=${PARENT_EVENT_ID}#ev-${PARENT_EVENT_ID}`,
          },
        }),
      ),
    ),
  );
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentDetail', () => {
  it('renders selected version text, model summary, provenance, status, and history links', async () => {
    const user = userEvent.setup();
    renderDetail();

    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(
      '/app/documents?folder=folder-1',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Acme launch packet.txt' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Specific users')).toBeTruthy();
    expect(screen.getByText('Selected version')).toBeTruthy();
    expect(screen.getByText(/v1 · 4\.0 KB · application\/octet-stream/)).toBeTruthy();
    expect(screen.getByText('Extracted text')).toBeTruthy();
    expect(screen.getAllByText(/Customer asks for launch readiness/).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getAllByText('Visual summary of the Acme launch packet.').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('email capture')).toBeTruthy();
    expect(screen.getAllByText('Chunked').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 chunks')).toBeTruthy();
    expect(screen.getByText('Content excerpts')).toBeTruthy();
    expect(screen.queryByText('Chunk 1')).toBeNull();
    expect(screen.queryByText('source text')).toBeNull();
    expect(screen.getAllByText('Page 1').length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById('chunk-chunk-text')?.textContent).toContain(
      'Customer asks for launch readiness',
    );
    const indexingDetails = screen.getByText('Indexing details').closest('details');
    expect(indexingDetails?.open).toBe(false);
    expect(indexingDetails?.textContent).toContain('chunk-text');
    expect(indexingDetails?.textContent).toContain('source_text');
    const previewLinks = screen.getAllByRole('link', { name: 'Preview' });
    expect(previewLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/app/documents/doc-1?version=2',
      '/app/documents/doc-1?version=1',
    ]);

    await user.click(screen.getByRole('button', { name: 'Event' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init?.body).toBe(
      JSON.stringify({ ref: { kind: 'timeline_event', id: PARENT_EVENT_ID } }),
    );
    expect((await screen.findByRole('link', { name: /Open full page/ })).getAttribute('href')).toBe(
      `/app/timeline?event=${PARENT_EVENT_ID}#ev-${PARENT_EVENT_ID}`,
    );
  });

  it('opens a signed download URL for the active version', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getAllByRole('button', { name: 'Download' })[0] ?? document.body);

    await waitFor(() => {
      expect(fakes.getDocumentDownloadUrlAction).toHaveBeenCalledWith({
        versionId: 'version-selected',
      });
    });
    expect(open).toHaveBeenCalledWith(
      'https://example.test/download/version-selected',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('renders unavailable preview and failed processing states without chunks', () => {
    renderDetail({
      versions: versions([
        {},
        {
          processingStatus: 'failed',
          processingError: 'OCR failed because the provider returned unreadable content.',
        },
      ]),
      activeVersionChunks: [],
    });

    expect(screen.getByText('Preview is not available for this file type.')).toBeTruthy();
    expect(screen.getByText('No extracted description is available yet.')).toBeTruthy();
    expect(screen.getByText('0 chunks')).toBeTruthy();
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    const error = screen.getAllByText(
      'OCR failed because the provider returned unreadable content.',
    )[0];
    expect(error?.closest('details')?.open).toBe(false);
  });
});
