import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: fakes.useQueryClient }));
vi.mock('@/components/audio-recorder', () => ({
  AudioRecorder: () => createElement('div', null, 'Voice recorder'),
}));
vi.mock('@/app/actions/events', () => ({
  createAudioEventAction: vi.fn(),
  createTextEventAction: vi.fn(),
  requestAudioUploadAction: vi.fn(),
}));

const { CaptureForm } = await import('./capture-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useQueryClient.mockReturnValue({
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  });
});

describe('CaptureForm', () => {
  it('renders team-visible composer controls', () => {
    const html = renderToStaticMarkup(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    expect(html).toContain('CAPTURE');
    expect(html).toContain('What happened?');
    expect(html).toContain('Visible to team');
    expect(html).toContain('Voice recorder');
    expect(html).toContain('Post');
  });

  it('renders private visibility when requested', () => {
    const html = renderToStaticMarkup(
      createElement(CaptureForm, {
        initialVisibility: 'private',
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    expect(html).toContain('Private (only me)');
  });
});
