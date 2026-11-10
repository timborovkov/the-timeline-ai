import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  canReplaceFirstRunStarter,
  documentProcessingSteps,
  firstCaptureJustLanded,
  orderChecklistItems,
  parsePublicWebsiteUrl,
  guidedAskEmptyHint,
  isWebsiteScanEnabled,
  listedWebsiteSourceEvents,
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

  it('explains the prefilled Ask in path-specific English', () => {
    expect(guidedAskEmptyHint('document')).toBe(
      'We filled in a question your upload can answer. Edit it or send it as it is.',
    );
    expect(guidedAskEmptyHint('website')).toBe(
      'We filled in a question this site can answer. Edit it or send it as it is.',
    );
    expect(guidedAskEmptyHint('email')).toBe(
      'We filled in a question this thread can answer. Edit it or send it as it is.',
    );
  });

  it('numbers website citations from listed pages, not a prepended capture id', () => {
    const pages = [
      { id: 'home', title: 'Studio' },
      { id: 'about', title: 'About' },
    ];
    expect(listedWebsiteSourceEvents(pages, { id: 'about', title: 'About' })).toEqual(pages);
    expect(listedWebsiteSourceEvents(pages, { id: 'home', title: 'Studio' })).toEqual(pages);
    expect(listedWebsiteSourceEvents(pages, { id: 'extra', title: 'Capture' })).toEqual([
      { id: 'extra', title: 'Capture' },
      ...pages,
    ]);
    const listed = listedWebsiteSourceEvents(pages, { id: 'about', title: 'About' });
    expect(listed.map((page, index) => ({ n: index + 1, id: page.id }))).toEqual([
      { n: 1, id: 'home' },
      { n: 2, id: 'about' },
    ]);
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

  it('enables website scan only when the flag and Firecrawl key are both set', () => {
    expect(isWebsiteScanEnabled({ WEBSITE_SCAN_ENABLED: true })).toBe(false);
    expect(isWebsiteScanEnabled({ WEBSITE_SCAN_ENABLED: true, FIRECRAWL_API_KEY: '' })).toBe(false);
    expect(
      isWebsiteScanEnabled({ WEBSITE_SCAN_ENABLED: false, FIRECRAWL_API_KEY: 'fc-test' }),
    ).toBe(false);
    expect(isWebsiteScanEnabled({ WEBSITE_SCAN_ENABLED: true, FIRECRAWL_API_KEY: 'fc-test' })).toBe(
      true,
    );
    expect(isWebsiteScanEnabled({ WEBSITE_SCAN_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test' })).toBe(
      true,
    );
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

  it('blocks a stale document attach from replacing skip or another live path', () => {
    expect(canReplaceFirstRunStarter({ phase: 'skipped', starterPath: 'skip' }, 'document')).toBe(
      false,
    );
    expect(
      canReplaceFirstRunStarter({ phase: 'processing', starterPath: 'email' }, 'document'),
    ).toBe(false);
    expect(canReplaceFirstRunStarter({ phase: 'choose', starterPath: null }, 'document')).toBe(
      true,
    );
    expect(canReplaceFirstRunStarter({ phase: 'failed', starterPath: 'website' }, 'document')).toBe(
      true,
    );
  });

  it('detects the first capture landing transition for the UI poll path', () => {
    const processing = {
      firstCaptureLandedAt: null,
      starterPath: 'document' as const,
    };
    const landed = {
      firstCaptureLandedAt: new Date('2026-11-09T12:00:00.000Z'),
      starterPath: 'document' as const,
    };
    expect(firstCaptureJustLanded(processing, landed)).toBe('document');
    expect(firstCaptureJustLanded(landed, landed)).toBeNull();
    expect(firstCaptureJustLanded(processing, { ...landed, starterPath: 'skip' })).toBeNull();
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
