export const TIMELINE_SKILLS_URL =
  'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills';

export const TIMELINE_PLUGIN_INSTALL_URL = `${TIMELINE_SKILLS_URL}#install-the-plugin`;
const TIMELINE_MCP_MANAGE_URL = 'https://thetimeline.cc/app/team/mcp-share';

export const TIMELINE_PLUGIN_INSTALL_PROMPT = `Install The Timeline plugin for this Codex environment.

Run these commands:
codex plugin marketplace add timborovkov/the-timeline-ai \\
  --ref main \\
  --sparse .agents/plugins \\
  --sparse plugins/timeline
codex plugin add timeline@timeline

Then verify that the timeline skill is installed.

Check only whether TIMELINE_MCP_KEY is present; do not print, echo, log, or inspect its value. If it is unavailable, stop and explain that a Timeline team admin must create it at ${TIMELINE_MCP_MANAGE_URL} because its plaintext is shown only once. Tell CLI users to set it in the terminal that will launch Codex, fully exit the current Codex process, and relaunch codex from that same terminal. Tell Codex app and IDE users to store TIMELINE_MCP_KEY=<one-time key> in ~/.codex/.env, outside any repository, restrict that file to their user account, and fully restart the app or extension. A new task alone cannot import an environment variable added after Codex started.

Never ask me to paste the key into chat or write it to a repository file.

When setup and the launch environment are ready, tell me to start a new task so Codex loads the plugin.`;

export const TIMELINE_SKILL_INSTALL_PROMPT = `$skill-installer Install this Timeline skill from GitHub:
- https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline`;

export const TIMELINE_MCP_COMMAND = `codex mcp add timeline \\
  --url "https://thetimeline.cc/api/mcp/server" \\
  --bearer-token-env-var TIMELINE_MCP_KEY`;

export const TIMELINE_AGENT_SKILL = {
  id: 'timeline',
  name: 'Timeline',
  description:
    'Choose the right Timeline MCP tools, expand source evidence, distinguish current state from activity, and cite consequential claims.',
} as const;

export const TIMELINE_AGENT_INSTALL_STEPS = [
  {
    title: 'Run the install prompt',
    body: 'Codex adds the sparse repository marketplace, installs the plugin, and checks the bundled Timeline skill.',
  },
  {
    title: 'Connect Timeline',
    body: 'A Timeline admin creates a one-time key. Export it in the CLI launch terminal, or store it as TIMELINE_MCP_KEY in ~/.codex/.env for the app or IDE.',
  },
  {
    title: 'Relaunch, then start a task',
    body: 'If you just added the key, fully relaunch Codex from the environment that contains it. A new task then discovers the plugin skill and MCP tools.',
  },
] as const;

export const TIMELINE_AGENT_ACCESS_FAQS = [
  {
    question: 'What can the key read?',
    answer:
      'Team-visible Timeline data only. Private and specific-user evidence remains unavailable to outbound keys.',
  },
  {
    question: 'Should I paste the key into the prompt?',
    answer:
      'No. For CLI, export it only in the terminal that launches Codex. For the app or IDE, store it in ~/.codex/.env outside any repository, restrict the file to your user account, and restart the host. The prompt tells the agent not to request or persist it.',
  },
  {
    question: 'Can the plugin change canonical work?',
    answer:
      'Not by default. Standard keys are read-only. An admin can separately enable paid, stateless Timeline agent turns, which may call enabled team-shared custom MCP tools and create proposals for human review but cannot write canonical state directly. Those third-party tools may have external side effects.',
  },
  {
    question: 'What about self-hosted Timeline?',
    answer:
      'Install the standalone Timeline skill, then use the MCP-only command with your own origin followed by /api/mcp/server.',
  },
  {
    question: 'Why do I need a new task?',
    answer:
      'Codex discovers the newly installed plugin skill and MCP tools at task start. Restart Codex first if you added TIMELINE_MCP_KEY after it started; for the CLI, relaunch it from the same terminal that exported the key.',
  },
] as const;

export const TIMELINE_AGENT_HELP_SEARCH_TEXT = [
  'Connect your agent to what actually happened.',
  'Install one general Timeline skill that teaches agents how to retrieve, verify, and cite team-visible workspace evidence.',
  'Install The Timeline plugin. One bundle adds the Timeline skill and the hosted Timeline MCP connection.',
  'Prefer a narrower setup? Install only the skill, or connect the MCP endpoint without the plugin.',
  'Skill only. Best for self-hosted Timeline or agents that already have an MCP connection.',
  'MCP only. Set TIMELINE_MCP_KEY in the terminal that will launch Codex, connect hosted Timeline, and relaunch Codex from that terminal.',
  'One skill, the whole workspace. It routes each request to the relevant Timeline tools and preserves citations, uncertainty, visibility, and evidence boundaries.',
  'Access, without surprises. The install path and access boundary are intentionally separate.',
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
  TIMELINE_MCP_COMMAND,
  TIMELINE_AGENT_SKILL.id,
  TIMELINE_AGENT_SKILL.name,
  TIMELINE_AGENT_SKILL.description,
  ...TIMELINE_AGENT_INSTALL_STEPS.flatMap((step) => [step.title, step.body]),
  ...TIMELINE_AGENT_ACCESS_FAQS.flatMap((item) => [item.question, item.answer]),
].join(' ');
