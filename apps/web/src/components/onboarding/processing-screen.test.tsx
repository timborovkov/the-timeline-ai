import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const { cleanup, render, screen } = await import('@testing-library/react');
const { ProcessingScreen } = await import('./processing-screen.js');
const { FailedScanScreen } = await import('./failed-scan-screen.js');

afterEach(() => {
  cleanup();
});

describe('ProcessingScreen', () => {
  it('names document steps without percentages or timings', () => {
    render(
      <ProcessingScreen
        title="Reading seed-deck.pdf"
        description="You can leave this screen. The record also appears on Home when it is ready."
        startedAt={new Date('2026-03-29T19:00:00Z')}
        captureUrl="https://example.test/onboarding?capture=fixture"
        steps={[
          { id: 'upload', label: 'Uploading', status: 'done' },
          {
            id: 'extract',
            label: 'Extracting text',
            status: 'active',
            detail: 'PDF and Office files up to 25 MB.',
          },
          { id: 'index', label: 'Indexing it for search and citations', status: 'waiting' },
        ]}
        inboundEmail={null}
        emailWaiting={false}
        onSwitch={() => undefined}
        onHome={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Reading seed-deck.pdf' })).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy capture link' })).toBeTruthy();
    expect(screen.getByText(/Started/).querySelector('time')?.dateTime).toBe(
      '2026-03-29T19:00:00.000Z',
    );
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another way' })).toBeTruthy();
    expect(screen.queryByText(/%|seconds|minutes/i)).toBeNull();
  });

  it('offers Slack setup and a resumable capture link while waiting for a message', () => {
    render(
      <ProcessingScreen
        title="Waiting for Slack"
        description=""
        startedAt={new Date('2026-03-29T19:00:00Z')}
        captureUrl="https://example.test/onboarding?capture=slack-fixture"
        steps={[]}
        inboundEmail={null}
        emailWaiting={false}
        connectorWaiting="slack"
        onSwitch={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: 'Install Slack' }).getAttribute('href')).toBe(
      '/api/slack/install/start',
    );
    expect(screen.getByRole('link', { name: 'Bind a channel' }).getAttribute('href')).toBe(
      '/app/team/slack',
    );
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/app');
    expect(screen.getByRole('button', { name: 'Copy capture link' })).toBeTruthy();
  });

  it('keeps the inbound address visible while waiting for email', () => {
    render(
      <ProcessingScreen
        title="Waiting"
        description=""
        steps={[]}
        inboundEmail="northwind-studio@inbound.test"
        emailWaiting
        onSwitch={() => undefined}
        onHome={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Waiting for your email' })).toBeTruthy();
    expect(screen.getByDisplayValue('northwind-studio@inbound.test')).toBeTruthy();
    expect(screen.getByText('Nothing has arrived yet.')).toBeTruthy();
  });
});

describe('FailedScanScreen', () => {
  it('offers upload and email after an empty scan', () => {
    render(
      <FailedScanScreen
        host="studio.example"
        reason="no_readable_text"
        onUpload={() => undefined}
        onEmail={() => undefined}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: "We couldn't read studio.example" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a deck or document' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forward an email' })).toBeTruthy();
  });
});
