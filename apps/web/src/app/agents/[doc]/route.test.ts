import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MCP_OAUTH_SCOPES,
  mcpStaticKeyScopes,
  resolveMcpOAuthConsentScopes,
} from '@timeline/shared/mcp-server';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { GET, generateStaticParams } from '@/app/agents/[doc]/route';
import {
  AGENT_MARKDOWN_HEADERS,
  RETIRED_HOSTED_MCP_TOOL_NAMES,
  TIMELINE_CURSOR_INSTALL_DEEPLINK,
  TIMELINE_CURSOR_MCP_CONFIG,
  buildAgentSetupMarkdown,
} from '@/lib/agent-setup';
import { readTimelineSkillMarkdown, timelineSkillMarkdownPath } from '@/lib/agent-setup-skill';
import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

async function getDoc(doc: string) {
  return GET(new Request(`https://thetimeline.cc/agents/${doc}`), {
    params: Promise.resolve({ doc }),
  });
}

describe('agent markdown routes', () => {
  it('serves setup.md as text/markdown with a stable snapshot', async () => {
    const response = await getDoc('setup.md');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(AGENT_MARKDOWN_HEADERS['content-type']);
    expect(response.headers.get('cache-control')).toBe(AGENT_MARKDOWN_HEADERS['cache-control']);
    const body = await response.text();
    expect(body).toBe(buildAgentSetupMarkdown());
    expect(body).toMatchSnapshot();
    for (const client of [
      'ChatGPT',
      'claude.ai',
      'Claude Desktop',
      'Grok Bot',
      'Claude Code',
      'Codex',
      'Cursor',
      'Hermes',
      'OpenClaw',
    ]) {
      expect(body).toContain(client);
    }
    expect(body).toContain('timeline.search');
    expect(body).toContain('small limit');
    expect(body).toContain("human's OK");
    expect(body).toContain('capture');
    expect(body).toContain('on by default');
    expect(body).toContain('$TIMELINE_INGEST_TOKEN');
    expect(body).toContain('Never print the token');
    expect(body).toContain('Then stop.');
    expect(body).toContain('Do not retry other hosts.');
  });

  it('serves SKILL.md byte-identical to the plugin skill file', async () => {
    const response = await getDoc('SKILL.md');
    const body = Buffer.from(await response.text(), 'utf8');
    const source = readFileSync(timelineSkillMarkdownPath());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(body.equals(source)).toBe(true);
    expect(body.equals(Buffer.from(readTimelineSkillMarkdown(), 'utf8'))).toBe(true);
  });

  it('precomputes the Cursor install deeplink from the MCP config', () => {
    expect(TIMELINE_CURSOR_INSTALL_DEEPLINK).toBe(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=timeline&config=${Buffer.from(
        JSON.stringify(TIMELINE_CURSOR_MCP_CONFIG),
        'utf8',
      ).toString('base64')}`,
    );
  });

  it('lists only the two markdown documents for static generation', () => {
    expect(generateStaticParams()).toEqual([{ doc: 'setup.md' }, { doc: 'SKILL.md' }]);
  });

  it('returns 404 for unknown agent markdown documents', async () => {
    const response = await getDoc('README.md');
    expect(response.status).toBe(404);
  });
});

describe('shipped agent surfaces', () => {
  it('does not advertise retired hosted MCP tool names', () => {
    const skill = readTimelineSkillMarkdown();
    const deprecatedAt = skill.indexOf('## Deprecated tool names');
    const currentSkill = deprecatedAt === -1 ? skill : skill.slice(0, deprecatedAt);
    const shipped = [
      buildAgentSetupMarkdown(),
      currentSkill,
      readFileSync(join(process.cwd(), 'src/lib/agent-install-content.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/lib/help-content.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/lib/llms-text.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/components/help/agent-install-guide.tsx'), 'utf8'),
    ].join('\n');

    for (const name of RETIRED_HOSTED_MCP_TOOL_NAMES) {
      expect(shipped).not.toContain(name);
    }
  });

  it('keeps the skill description for Timeline-triggered routing', () => {
    const match = /^description:\s*(.+)$/m.exec(readTimelineSkillMarkdown());
    expect(match?.[1]).toContain('Timeline');
    expect(match?.[1]).toContain('timeline.*');
  });

  it('documents the live capture OAuth scope and default-on consent', () => {
    expect(MCP_OAUTH_SCOPES).toEqual(['read', 'capture', 'agent:ask']);
    expect(resolveMcpOAuthConsentScopes(['read'], { grantCapture: true })).toEqual([
      'read',
      'capture',
    ]);
    expect(resolveMcpOAuthConsentScopes(['read'], { grantCapture: false })).toEqual(['read']);
    expect(mcpStaticKeyScopes({ allowCapture: true, allowAgent: false })).toEqual([
      'read',
      'capture',
    ]);
    expect(mcpStaticKeyScopes({ allowCapture: false, allowAgent: false })).toEqual(['read']);
    const setup = buildAgentSetupMarkdown();
    const skill = readTimelineSkillMarkdown();
    for (const text of [setup, skill]) {
      expect(text).toContain('`capture`');
      expect(text).toContain('on by default');
    }
    expect(setup).toContain('Default OAuth is `read` plus `capture`');
    expect(setup).toContain('uncheck it for a read-only grant');
    expect(setup).toContain('capture checkbox');
    expect(setup).toContain('`timeline.remember` needs the `capture` scope');
  });

  it('points ingest webhooks at this deployment instead of only hosted Timeline', () => {
    const skill = readTimelineSkillMarkdown();
    const setup = buildAgentSetupMarkdown();
    const hostedWebhook = `${CANONICAL_PUBLIC_ORIGIN}/api/webhooks/ingest`;
    for (const text of [skill, setup]) {
      expect(text).toContain("this Timeline deployment's `/api/webhooks/ingest`");
      expect(text).toContain(hostedWebhook);
      expect(text).toMatch(/self-hosted/i);
      expect(text).toContain("deployment's own origin");
      expect(text).toContain('returns 401');
    }
  });
});
