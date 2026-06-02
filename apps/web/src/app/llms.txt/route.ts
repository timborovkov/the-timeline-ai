import { buildLlmsTxt, LLMS_TEXT_HEADERS } from '@/lib/llms-text';

export function GET() {
  return new Response(buildLlmsTxt(), { headers: LLMS_TEXT_HEADERS });
}
