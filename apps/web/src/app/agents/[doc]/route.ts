import { AGENT_MARKDOWN_DOCS, AGENT_MARKDOWN_HEADERS, isAgentMarkdownDoc } from '@/lib/agent-setup';
import { agentMarkdownBody } from '@/lib/agent-setup-skill';

interface AgentMarkdownRouteContext {
  params: Promise<{ doc: string }>;
}

export function generateStaticParams() {
  return AGENT_MARKDOWN_DOCS.map((doc) => ({ doc }));
}

export async function GET(_request: Request, context: AgentMarkdownRouteContext) {
  const { doc } = await context.params;
  if (!isAgentMarkdownDoc(doc)) {
    return new Response('Not Found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(agentMarkdownBody(doc), { headers: AGENT_MARKDOWN_HEADERS });
}
