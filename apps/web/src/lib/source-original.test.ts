import { describe, expect, it } from 'vitest';

import {
  framedHtmlDocument,
  hasSourceOriginal,
  sourceOriginalFromEvent,
} from '@/lib/source-original';

describe('sourceOriginalFromEvent', () => {
  it('prefers email HTML and keeps a readable text fallback plus cleaned JSON', () => {
    const original = sourceOriginalFromEvent({
      source: 'email',
      contentText: 'Please review the appendix.',
      sourceMetadata: {
        subject: 'Vendor contract review',
        html_body: '<p>Please review the <b>appendix</b>.</p>',
        source_payload_ref: 'inline://timeline/email/abc',
        payload_digest: 'sha256:deadbeef',
        source_snapshot: {
          provider: 'postmark',
          subject: 'Vendor contract review',
          html_body: '<p>Please review the <b>appendix</b>.</p>',
          text_body: 'Please review the appendix.',
          content_text: 'Please review the appendix.',
          from: { email: 'mika@example.com' },
        },
      },
    });

    expect(original.label).toBe('Original email');
    expect(original.html).toContain('<b>appendix</b>');
    expect(original.text).toBe('Please review the appendix.');
    expect(original.json).toEqual({
      provider: 'postmark',
      subject: 'Vendor contract review',
      from: { email: 'mika@example.com' },
    });
    expect(hasSourceOriginal(original)).toBe(true);
  });

  it('pretty-parses ingest webhook JSON bodies and omits credentials', () => {
    const original = sourceOriginalFromEvent({
      source: 'ingest_webhook',
      contentText: 'Deploy hook: atlas-web production rollout finished.',
      sourceMetadata: {
        webhook_name: 'atlas-web production',
        credential_id: '30000000-0000-4000-8000-000000000099',
        request_headers: { authorization: 'Bearer secret' },
        source_snapshot: {
          webhook_name: 'atlas-web production',
          credential_id: '30000000-0000-4000-8000-000000000099',
          request_headers: { authorization: 'Bearer secret' },
          body: '{"status":"success","sha":"8f3a1c2"}',
        },
      },
    });

    expect(original.label).toBe('atlas-web production payload');
    expect(original.json).toEqual({
      webhook_name: 'atlas-web production',
      body: { status: 'success', sha: '8f3a1c2' },
    });
  });

  it('uses nested GitHub records when no snapshot exists', () => {
    const original = sourceOriginalFromEvent({
      source: 'integration',
      contentText: 'GitHub workflow "CI" #1042 success',
      sourceMetadata: {
        provider: 'github',
        event_type: 'workflow_run.success',
        github: { type: 'workflow_run', repo: 'acme/app', head_branch: 'main' },
      },
    });

    expect(original.label).toBe('Original payload');
    expect(original.json).toEqual({
      github: { type: 'workflow_run', repo: 'acme/app', head_branch: 'main' },
    });
    expect(original.text).toBeNull();
  });
});

describe('framedHtmlDocument', () => {
  it('wraps fragments in a CSP-locked document', () => {
    const framed = framedHtmlDocument('<p>Hi</p>');
    expect(framed).toContain("default-src 'none'");
    expect(framed).toContain('<p>Hi</p>');
    expect(framed).toContain('<!doctype html>');
  });
});

describe('source original filename redaction', () => {
  it('truncates generated attachment names in leftover JSON', () => {
    const filename = 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg';
    const original = sourceOriginalFromEvent({
      source: 'slack',
      contentText: '',
      sourceMetadata: {
        slack_channel_name: 'design',
        slack_sender_name: 'Alex',
        attachments: [{ name: filename, mimetype: 'image/jpeg' }],
      },
    });

    expect(JSON.stringify(original.json)).not.toContain(filename);
    expect(JSON.stringify(original.json)).toContain('AgACAgQ…msbjOI.jpg');
  });
});
