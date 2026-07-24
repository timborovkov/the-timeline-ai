import { describe, expect, it } from 'vitest';

import { AGENT_PROMPT_VERSION, buildSystemPrompt } from '#src/agent/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('keeps first-person statements in retrieved messages attached to their sender', () => {
    const prompt = buildSystemPrompt({
      teamName: 'AuditAI',
      userName: 'Tim',
      currentDate: new Date('2026-07-24T12:00:00.000Z'),
    });

    expect(AGENT_PROMPT_VERSION).toBe('agent-v19-2026-07');
    expect(prompt).toContain("the event's sender is the speaker");
    expect(prompt).toContain('For a forwarded email, the original forwarded sender is the speaker');
    expect(prompt).toContain('A mention/tag identifies an addressee, not the speaker.');
    expect(prompt).toContain(
      "Never transfer a sender's commitment, travel, availability, opinion, or status to another participant.",
    );
    expect(prompt).toContain(
      'If they are correcting an unresolved approval proposal, call list_pending_approvals',
    );
    expect(prompt).toContain('then call revise_suggestion with their feedback');
    expect(prompt).toContain(
      'If they are correcting an accepted/current object, calendar event, or board item',
    );
  });
});
