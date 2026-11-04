import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentMarkdownDoc } from '@/lib/agent-setup';

import { buildAgentSetupMarkdown } from '@/lib/agent-setup';

const TIMELINE_SKILL_RELATIVE = 'plugins/timeline/skills/timeline/SKILL.md';

export function timelineSkillMarkdownPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../', TIMELINE_SKILL_RELATIVE),
    join(process.cwd(), '../../', TIMELINE_SKILL_RELATIVE),
    join(process.cwd(), TIMELINE_SKILL_RELATIVE),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Missing ${TIMELINE_SKILL_RELATIVE}`);
  }
  return found;
}

export function readTimelineSkillMarkdown(): string {
  return readFileSync(timelineSkillMarkdownPath(), 'utf8');
}

export function agentMarkdownBody(doc: AgentMarkdownDoc): string {
  return doc === 'SKILL.md' ? readTimelineSkillMarkdown() : buildAgentSetupMarkdown();
}
