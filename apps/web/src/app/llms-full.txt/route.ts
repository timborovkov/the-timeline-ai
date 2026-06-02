import { buildLlmsFullTxt, LLMS_TEXT_HEADERS } from '@/lib/llms-text';

export function GET() {
  return new Response(buildLlmsFullTxt(), { headers: LLMS_TEXT_HEADERS });
}
