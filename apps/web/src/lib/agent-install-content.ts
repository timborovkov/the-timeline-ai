export const TIMELINE_SKILLS_URL =
  'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills';

export const TIMELINE_CODEX_PLUGIN_INSTALL_URL = `${TIMELINE_SKILLS_URL}#install-in-codex`;
export const TIMELINE_CLAUDE_PLUGIN_INSTALL_URL = `${TIMELINE_SKILLS_URL}#install-in-claude-code`;

export const TIMELINE_PLUGIN_INSTALL_PROMPT = `Install The Timeline plugin for this Codex environment.

Run these commands:
codex plugin marketplace add timborovkov/the-timeline-ai \\
  --ref main \\
  --sparse .agents/plugins \\
  --sparse plugins/timeline
codex plugin add timeline@timeline

Then verify that the timeline skill is installed.

The bundled MCP connection uses Timeline OAuth and does not need a bearer key in the plugin manifest. Fully restart Codex, start a new task, and complete the browser flow when prompted: sign in to Timeline, choose the team to share, review the requested scopes, and approve or deny access. The default scope is read. Never request agent:ask unless I explicitly ask for paid, proposal-only Timeline agent turns and the consent screen shows that scope.

When setup is ready, tell me to start a new task so Codex loads the plugin and begins OAuth authorization.`;

export const TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND = `claude plugin marketplace add timborovkov/the-timeline-ai
claude plugin install timeline@timeline`;

export const TIMELINE_SKILL_INSTALL_PROMPT = `$skill-installer Install this Timeline skill from GitHub:
- https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline`;

export const TIMELINE_MCP_COMMAND = `codex mcp add timeline \\
  --url "https://thetimeline.cc/api/mcp/server"`;

export const TIMELINE_AGENT_SKILL = {
  id: 'timeline',
  name: 'Timeline',
  description:
    'Choose the right Timeline MCP tools, expand source evidence, distinguish current state from activity, and cite consequential claims.',
} as const;

export const TIMELINE_AGENT_INSTALL_STEPS = [
  {
    title: 'Install for your agent',
    body: 'Use the Codex install prompt or run the Claude Code marketplace commands. Both packages include the Timeline skill and hosted MCP connection.',
  },
  {
    title: 'Authorize Timeline',
    body: 'Sign in when the browser opens, choose the team to share, review the requested scopes, and approve or deny access.',
  },
  {
    title: 'Start a Timeline-backed task',
    body: 'After consent, start a new task or conversation so your agent uses the installed skill to retrieve and cite workspace evidence.',
  },
] as const;

export const TIMELINE_AGENT_ACCESS_FAQS = [
  {
    question: 'What can OAuth read?',
    answer:
      'The default read grant follows your current membership and visibility in the team you choose. That includes private and specifically shared evidence you can already access. A manual static key instead represents the team and sees team-visible data only.',
  },
  {
    question: 'Should I paste a key into the prompt?',
    answer:
      'No. The normal plugin and direct-URL flows use browser-based OAuth. Static keys are a compatibility fallback for manual clients; keep one only in that client’s protected credential storage and never paste it into chat or a repository.',
  },
  {
    question: 'Can the plugin change canonical work?',
    answer:
      'Not with the default read scope. A current team owner or admin can separately approve agent:ask for paid, stateless Timeline agent turns. It may call enabled team-shared custom MCP tools and create proposals for human review, but cannot write canonical Timeline state directly. Third-party tools may have external side effects.',
  },
  {
    question: 'What about self-hosted Timeline?',
    answer:
      'Install the standalone Timeline skill, then use the MCP-only command with your own origin followed by /api/mcp/server.',
  },
  {
    question: 'Why do I need a new task?',
    answer:
      'Codex and Claude Code load newly installed plugin content after restart. Restart your agent, then begin a new task or conversation; the MCP connection can open the OAuth flow from there.',
  },
] as const;

export const TIMELINE_AGENT_HELP_SEARCH_TEXT = [
  'Connect your agent to what actually happened.',
  'Install one general Timeline skill that teaches agents how to retrieve, verify, and cite workspace evidence visible to the authorizing member.',
  'Install The Timeline plugin in Codex or Claude Code. One bundle adds the Timeline skill and the hosted Timeline MCP connection.',
  'Prefer a narrower setup? Install only the skill, or connect the MCP endpoint without the plugin.',
  'Skill only. Best for self-hosted Timeline or agents that already have an MCP connection.',
  'MCP only. Add the hosted Timeline URL, then sign in, choose a team, and approve the requested OAuth scopes in the browser.',
  'One skill, the whole workspace. It routes each request to the relevant Timeline tools and preserves citations, uncertainty, visibility, and evidence boundaries.',
  'Access, without surprises. The install path and access boundary are intentionally separate.',
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
  TIMELINE_SKILL_INSTALL_PROMPT,
  TIMELINE_MCP_COMMAND,
  TIMELINE_AGENT_SKILL.id,
  TIMELINE_AGENT_SKILL.name,
  TIMELINE_AGENT_SKILL.description,
  ...TIMELINE_AGENT_INSTALL_STEPS.flatMap((step) => [step.title, step.body]),
  ...TIMELINE_AGENT_ACCESS_FAQS.flatMap((item) => [item.question, item.answer]),
].join(' ');
