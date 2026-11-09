import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  documentProcessingSteps,
  orderChecklistItems,
  parsePublicWebsiteUrl,
  prefilledAskQuestion,
  recommendedGoLiveChannel,
  scanFailureCopy,
  shouldRedirectToSetup,
  shouldShowGettingStartedStrip,
  suggestionTypeRank,
  websiteProcessingSteps,
} from '#src/onboarding/first-run.js';

describe('first-run helpers', () => {
  it('recommends a go-live channel from how the team works, never team size', () => {
    expect(recommendedGoLiveChannel('email')).toBe('email');
    expect(recommendedGoLiveChannel('chat')).toBe('slack');
    expect(recommendedGoLiveChannel('dealflow')).toBe('email');
    expect(recommendedGoLiveChannel('delivery')).toBe('slack');
    expect(recommendedGoLiveChannel('other')).toBeNull();
    expect(recommendedGoLiveChannel(null)).toBeNull();
  });

  it('prefills Ask from the starter path', () => {
    expect(prefilledAskQuestion({ path: 'email', workStyle: 'email' })).toBe(
      'What did this thread ask for, and who owns the next step?',
    );
    expect(prefilledAskQuestion({ path: 'website', workStyle: null })).toBe(
      'What does this site say the company offers, and who is named?',
    );
    expect(prefilledAskQuestion({ path: 'document', workStyle: 'dealflow' })).toBe(
      'What is this document asking for, and who are the named counterparts?',
    );
  });

  it('maps document processing status onto named steps without invented counts', () => {
    const steps = documentProcessingSteps('extracting', false);
    expect(steps.map((step) => [step.id, step.status])).toEqual([
      ['upload', 'done'],
      ['extract', 'active'],
      ['index', 'waiting'],
      ['suggest', 'waiting'],
    ]);
    expect(steps[1]?.detail).toBe('PDF and Office files up to 25 MB.');
  });

  it('keeps website scan copy honest about the page cap and robots', () => {
    const running = websiteProcessingSteps({
      host: 'studio.example',
      failureReason: null,
      pageCount: 2,
      hasSuggestions: false,
    });
    expect(running[2]?.detail).toContain('Up to 5 public pages');
    expect(scanFailureCopy({ host: 'studio.example', reason: 'robots' }).body).toContain(
      'asked automated readers not to fetch',
    );
  });

  it('parses public website addresses and rejects local ones', () => {
    expect(parsePublicWebsiteUrl('studio.example')).toEqual({
      href: 'https://studio.example/',
      host: 'studio.example',
    });
    expect(parsePublicWebsiteUrl('fc-studio.example')).toEqual({
      href: 'https://fc-studio.example/',
      host: 'fc-studio.example',
    });
    expect(parsePublicWebsiteUrl('http://localhost')).toEqual({
      error: 'Enter a public website, not a local address.',
    });
    expect(parsePublicWebsiteUrl('http://169.254.169.254')).toEqual({
      error: 'Enter a public website, not a local address.',
    });
    expect(parsePublicWebsiteUrl('http://10.0.0.1')).toEqual({
      error: 'Enter a public website, not a local address.',
    });
  });

  it('only sends the starter back to setup for welcome and choose', () => {
    expect(
      shouldRedirectToSetup({
        firstRun: {
          teamId: 't',
          startedByUserId: 'u',
          phase: 'welcome',
          starterPath: null,
          starterSelectedAt: null,
          captureDocumentId: null,
          captureEventId: null,
          websiteUrl: null,
          websiteHost: null,
          scanFailureReason: null,
          guideHiddenAt: null,
          firstCaptureLandedAt: null,
          workStyle: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
        userId: 'u',
      }),
    ).toBe(true);
    expect(
      shouldShowGettingStartedStrip({ phase: 'record', hidden: false, pathname: '/app/chat' }),
    ).toBe(true);
    expect(
      shouldShowGettingStartedStrip({ phase: 'record', hidden: false, pathname: '/app' }),
    ).toBe(false);
  });

  it('reorders the home checklist around the chosen capture path', () => {
    const items = orderChecklistItems(
      [
        { key: 'first_note', label: 'Capture one timeline event' },
        { key: 'first_ask', label: 'Ask the agent a question' },
        { key: 'review_proposal', label: 'Review a proposal' },
        { key: 'first_document', label: 'Upload a document' },
      ],
      'document',
    );
    expect(items[0]).toEqual({ key: 'first_document', label: 'Upload a document' });
    expect(suggestionTypeRank('dealflow', 'Deal')).toBeLessThan(
      suggestionTypeRank('dealflow', 'Project'),
    );
  });
});
