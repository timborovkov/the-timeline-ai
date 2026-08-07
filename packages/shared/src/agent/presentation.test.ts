import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_CHAT_MAX_CHARACTERS,
  EXTERNAL_CHAT_MAX_OUTPUT_TOKENS,
  formatAgentAnswerForPresentation,
  presentationInstructions,
  resolveAgentPresentation,
} from '#src/agent/presentation.js';

describe('agent presentation policy', () => {
  it('reserves rich presentation for the literal web delivery surface', () => {
    expect(resolveAgentPresentation('web')).toBe('web_rich');
    expect(resolveAgentPresentation('telegram')).toBe('external_chat');
    expect(resolveAgentPresentation('slack')).toBe('external_chat');
    expect(resolveAgentPresentation('future-provider')).toBe('external_chat');
  });

  it('gives web chat complete cited-answer guidance without an output cap', () => {
    const policy = presentationInstructions('web_rich');

    expect(policy.system).toContain('complete, source-linked answer');
    expect(policy.system).toContain('Keep Timeline citations inline');
    expect(policy.maxOutputTokens).toBeUndefined();
  });

  it('gives external chat a concise default and bounded expansion budget', () => {
    const policy = presentationInstructions('external_chat');

    expect(policy.system).toContain('about 120 words');
    expect(policy.system).toContain('3–5 bullets');
    expect(policy.system).toContain('explicitly asks for more detail');
    expect(policy.system).toContain('Do not add a sources section');
    expect(policy.maxOutputTokens).toBe(EXTERNAL_CHAT_MAX_OUTPUT_TOKENS);
    expect(EXTERNAL_CHAT_MAX_OUTPUT_TOKENS).toBe(900);
    expect(EXTERNAL_CHAT_MAX_CHARACTERS).toBe(4096);
  });
});

describe('formatAgentAnswerForPresentation', () => {
  it('preserves rich web Markdown and full Timeline citations', () => {
    const answer =
      '**Launch:** ready [ev:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee].\nThe system prompt review is Tuesday.';

    expect(formatAgentAnswerForPresentation(answer, 'web_rich')).toEqual({
      text: answer,
      truncated: false,
      removedReferences: 0,
    });
  });

  it('removes full, compact, adjacent, malformed, document, and route references', () => {
    const answer = [
      '**Launch:** ready [ev:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee][ent:1234abcd].',
      '- Review [cal:abcd1234] and [task:not-a-valid-id].',
      '- Contract [doc:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#v2:chunk:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb].',
      '- Open settings [route:team/invites].',
      '- [board:deadbeef]',
      '- ([note:cafebabe])',
      'Malformed [ev:feedbeef and [doc:deadbeef#v2:chunk:cafebabe',
      'Trailing cal:1234abcd] reference.',
      'Naked ev:a74b9875 reference.',
    ].join('\n');

    expect(formatAgentAnswerForPresentation(answer, 'external_chat')).toEqual({
      text: [
        'Launch: ready.',
        '- Review.',
        '- Contract.',
        '- Open settings.',
        'Malformed',
        'Trailing reference.',
        'Naked reference.',
      ].join('\n'),
      truncated: false,
      removedReferences: 12,
    });
  });

  it('removes prose-labelled internal event ids but preserves provider identifiers', () => {
    const answer =
      'Raw event_id: eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee supports GitHub #347 and Linear ENG-42 (EV ID a74b9875).';

    expect(formatAgentAnswerForPresentation(answer, 'external_chat').text).toBe(
      'Supports GitHub #347 and Linear ENG-42.',
    );
  });

  it('is idempotent after plain-text cleanup', () => {
    const once = formatAgentAnswerForPresentation(
      '- **Owner:** Ada [ev:abcd1234].\n- [task:deadbeef]',
      'external_chat',
    );
    const twice = formatAgentAnswerForPresentation(once.text, 'external_chat');

    expect(twice).toEqual({ text: once.text, truncated: false, removedReferences: 0 });
  });

  it('truncates oversized external answers at a line boundary', () => {
    const line = 'A'.repeat(1000);
    const answer = Array.from({ length: 6 }, () => `- ${line}`).join('\n');
    const formatted = formatAgentAnswerForPresentation(answer, 'external_chat');

    expect(formatted.text.length).toBeLessThanOrEqual(EXTERNAL_CHAT_MAX_CHARACTERS);
    expect(formatted.text.endsWith('…')).toBe(true);
    expect(formatted.truncated).toBe(true);
  });
});
