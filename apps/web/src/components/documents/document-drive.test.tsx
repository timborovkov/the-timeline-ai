import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  useQueryClient: vi.fn(),
  useDocumentListQuery: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: fakes.useQueryClient }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/use-paginated-queries', () => ({
  useDocumentListQuery: fakes.useDocumentListQuery,
}));
vi.mock('@/app/actions/documents', () => ({
  createFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  finalizeDocumentVersionAction: vi.fn(),
  requestDocumentUploadAction: vi.fn(),
}));

const { DocumentDrive } = await import('./document-drive.js');

function renderDrive(overrides: Partial<Parameters<typeof DocumentDrive>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(DocumentDrive, {
      currentFolderId: null,
      breadcrumbs: [{ id: null, name: 'Documents' }],
      folders: [],
      documents: [],
      documentsNextCursor: null,
      defaultVisibility: 'team',
      defaultVisibilityUserIds: null,
      members: [],
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useQueryClient.mockReturnValue({ setQueryData: vi.fn() });
  fakes.useDocumentListQuery.mockImplementation((_folderId: string | null, initial: unknown) => ({
    data: { pages: [initial] },
  }));
});

describe('DocumentDrive', () => {
  it('renders empty drive actions', () => {
    const html = renderDrive();

    expect(html).toContain('New folder');
    expect(html).toContain('Upload');
    expect(html).toContain('No documents yet');
    expect(html).toContain('Upload first document');
  });

  it('renders folders, documents, breadcrumbs, and visibility controls', () => {
    const html = renderDrive({
      currentFolderId: 'folder-1',
      breadcrumbs: [
        { id: null, name: 'Documents' },
        { id: 'folder-1', name: 'Customers' },
      ],
      folders: [
        {
          id: 'folder-2',
          name: 'Acme',
          visibility: 'team',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      ],
      documents: [
        {
          id: 'doc-1',
          name: 'Proposal.pdf',
          metadata: {},
          fileKind: 'document',
          visibility: 'private',
          updatedAt: '2026-06-01T10:00:00.000Z',
          ownerUserId: 'user-1',
          currentVersion: {
            id: 'version-1',
            version: 1,
            byteSize: 1536,
            contentType: 'application/pdf',
            processingStatus: 'embedded',
            sourceEventId: 'event-1',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
          provenance: {
            source: 'telegram',
            sourceEventId: 'event-1',
            parentEventId: 'parent-event-1',
            occurredAt: '2026-06-01T09:59:00.000Z',
            summary: 'Uploaded Proposal.pdf',
          },
          description: 'A customer proposal with pricing and terms.',
          presentation: {
            displayTitle: 'Proposal.pdf',
            storedName: 'Proposal.pdf',
            suggestedTitle: null,
            isGeneratedName: false,
            fallbackTitle: 'PDF attachment',
          },
        },
      ],
      defaultVisibility: 'specific_users',
      defaultVisibilityUserIds: ['user-1'],
      members: [{ id: 'user-1', label: 'Ada' }],
    });

    expect(html).toContain('Customers');
    expect(html).toContain('Folders');
    expect(html).toContain('Acme');
    expect(html).toContain('Documents');
    expect(html).toContain('Proposal.pdf');
    expect(html).toContain('A customer proposal with pricing and terms.');
    expect(html).toContain('Telegram');
    expect(html).toContain('/app/timeline?event=parent-event-1#ev-parent-event-1');
    expect(html).toContain('New item visibility');
    expect(html).toContain('Ada');
  });

  it('renders suggested titles for generated captured filenames', () => {
    const html = renderDrive({
      documents: [
        {
          id: 'doc-generated',
          name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
          metadata: { suggested_title: 'Whiteboard planning photo' },
          fileKind: 'document',
          visibility: 'team',
          updatedAt: '2026-06-01T10:00:00.000Z',
          ownerUserId: 'user-1',
          currentVersion: {
            id: 'version-generated',
            version: 1,
            byteSize: 1536,
            contentType: 'image/jpeg',
            processingStatus: 'chunked',
            sourceEventId: null,
            createdAt: '2026-06-01T10:00:00.000Z',
          },
          provenance: {
            source: 'telegram',
            sourceEventId: null,
            parentEventId: null,
            occurredAt: null,
            summary: null,
          },
          description: 'A photo of a whiteboard with planning notes.',
          presentation: {
            displayTitle: 'Whiteboard planning photo',
            storedName: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
            suggestedTitle: 'Whiteboard planning photo',
            isGeneratedName: true,
            fallbackTitle: 'Image attachment',
          },
        },
      ],
    });

    expect(html).toContain('Whiteboard planning photo');
    expect(html).toContain('Stored as');
    expect(html).toContain('planning notes');
  });
});
