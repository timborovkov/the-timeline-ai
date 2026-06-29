import { PGlite } from '@electric-sql/pglite';
import { MockLanguageModelV3 } from 'ai/test';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LanguageModel } from 'ai';

import { askAgent, formatBotPlainTextAnswer } from '#src/agent/ask.js';
import { resetEnvForTests } from '#src/env.js';
import { applyDbMigrations } from '#src/test/pglite.js';

// askAgent is the non-browser entry point for Slack/Telegram/email-style asks.
// These tests keep the wrapper honest while deeper agent behavior stays in the
// deterministic tool evals: auth/team gates, prompt/tool wiring, truncation,
// and failure mapping must remain stable without touching live models.

const ENV_BACKUP = { ...process.env };
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OUTSIDER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ENTITY_ID = '99999999-9999-4999-8999-999999999999';

type Db = ReturnType<typeof drizzle>;

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'ask-agent-team', 'Ask Agent Team');
    INSERT INTO users (id, email, name)
    VALUES
      ('${USER_ID}', 'ask-owner@example.com', 'Ada Owner'),
      ('${OUTSIDER_ID}', 'ask-outsider@example.com', 'Ollie Outsider');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

function makeStreamModel(text: string, capture?: (opts: unknown) => void): LanguageModel {
  return new MockLanguageModelV3({
    doStream: ((opts: unknown) => {
      capture?.(opts);
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' });
            if (text.length > 0) controller.enqueue({ type: 'text-delta', id: '1', delta: text });
            controller.enqueue({ type: 'text-end', id: '1' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
      });
    }) as never,
  });
}

function makeFailingModel(): LanguageModel {
  return new MockLanguageModelV3({
    doStream: (() => Promise.reject(new Error('model down'))) as never,
  });
}

describe('formatBotPlainTextAnswer', () => {
  it('removes chat citations and Markdown emphasis for bot delivery', () => {
    expect(
      formatBotPlainTextAnswer(
        `Telegram-keskustelun perusteella ensi maanantaina on palaveri **DFK:n** kanssa - klo 10 Bulevardilla [ev:${EVENT_ID}] [ent:${ENTITY_ID}].`,
      ),
    ).toBe(
      'Telegram-keskustelun perusteella ensi maanantaina on palaveri DFK:n kanssa - klo 10 Bulevardilla.',
    );
  });

  it('keeps useful plain text from code, links, and simple lists', () => {
    expect(
      formatBotPlainTextAnswer(
        [
          '### Summary',
          '- `Acme` needs the _SOC2_ packet: [folder](https://example.com/docs).',
          `- Owner is **Ada** [ev:${EVENT_ID}].`,
        ].join('\n'),
      ),
    ).toBe(
      [
        'Summary',
        '- Acme needs the SOC2 packet: folder (https://example.com/docs).',
        '- Owner is Ada.',
      ].join('\n'),
    );
  });

  it('removes emphasis around short words and punctuation-adjacent text', () => {
    expect(
      formatBotPlainTextAnswer(
        [
          '**I** met with **Ada**, then reviewed (**note**) and __OK__).',
          'Keep snake_case and mid_word_text intact, but strip _yes_ and *no*.',
        ].join('\n'),
      ),
    ).toBe(
      [
        'I met with Ada, then reviewed (note) and OK).',
        'Keep snake_case and mid_word_text intact, but strip yes and no.',
      ].join('\n'),
    );
  });
});

describe('askAgent', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    process.env = {
      ...ENV_BACKUP,
      AUTH_SECRET: 'a'.repeat(32),
      DATABASE_URL: 'postgres://user:pass@localhost:5432/timeline_test',
      OPENROUTER_API_KEY: 'sk-test',
      QDRANT_URL: 'http://qdrant.test:6333',
    };
    resetEnvForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
  });

  it('wires the team prompt, user message, and tools into the injected model', async () => {
    let captured: {
      system?: string;
      prompt?: unknown;
      tools?: Record<string, unknown>;
      stopWhen?: unknown;
    } = {};
    const result = await askAgent(
      {
        db: db as never,
        teamId: TEAM_ID,
        userId: USER_ID,
        userName: 'Ada',
        question: 'What do we know about Acme?',
        maxSteps: 3,
      },
      {
        model: makeStreamModel('Acme has a renewal due Friday.', (opts) => {
          captured = opts as typeof captured;
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      answer: 'Acme has a renewal due Friday.',
      truncated: false,
    });
    const capturedJson = JSON.stringify(captured);
    expect(capturedJson).toContain('Ask Agent Team');
    expect(capturedJson).toContain('Ada');
    expect(capturedJson).toContain('What do we know about Acme?');
    expect(capturedJson).toContain('search_timeline');
    expect(capturedJson).toContain('list_tasks');
    expect(capturedJson).toContain('list_calendar_events');
  });

  it('returns unconfigured before membership work when agent dependencies are missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();

    await expect(
      askAgent({
        db: db as never,
        teamId: TEAM_ID,
        userId: USER_ID,
        question: 'hi',
      }),
    ).resolves.toEqual({ ok: false, error: 'unconfigured' });
  });

  it('rejects non-members without invoking the model', async () => {
    await expect(
      askAgent(
        {
          db: db as never,
          teamId: TEAM_ID,
          userId: OUTSIDER_ID,
          question: 'Can I see this team?',
        },
        { model: makeStreamModel('should not run') },
      ),
    ).resolves.toEqual({ ok: false, error: 'not_a_member' });
  });

  it('maps empty model output and thrown model failures to failed', async () => {
    await expect(
      askAgent(
        {
          db: db as never,
          teamId: TEAM_ID,
          userId: USER_ID,
          question: 'empty?',
        },
        { model: makeStreamModel('   ') },
      ),
    ).resolves.toEqual({ ok: false, error: 'failed' });

    await expect(
      askAgent(
        {
          db: db as never,
          teamId: TEAM_ID,
          userId: USER_ID,
          question: 'fail?',
        },
        { model: makeFailingModel() },
      ),
    ).resolves.toEqual({ ok: false, error: 'failed' });
  });

  it('truncates long answers to the Telegram delivery limit', async () => {
    const result = await askAgent(
      {
        db: db as never,
        teamId: TEAM_ID,
        userId: USER_ID,
        question: 'long?',
      },
      { model: makeStreamModel('x'.repeat(4100)) },
    );

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) {
      expect(result.answer).toHaveLength(4096);
      expect(result.answer.endsWith('…')).toBe(true);
    }
  });

  it('returns plain bot text instead of web-chat citations and Markdown', async () => {
    const result = await askAgent(
      {
        db: db as never,
        teamId: TEAM_ID,
        userId: USER_ID,
        question: 'meeting?',
      },
      {
        model: makeStreamModel(
          `You have a meeting with **DFK:n** at 10 on Monday [ev:${EVENT_ID}].`,
        ),
      },
    );

    expect(result).toEqual({
      ok: true,
      answer: 'You have a meeting with DFK:n at 10 on Monday.',
      truncated: false,
    });
  });
});
