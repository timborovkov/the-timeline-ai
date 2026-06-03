export interface PromptContextEvent {
  /** ISO timestamp of when the event occurred. */
  occurredAt: string;
  /** Already-resolved content text (transcript for audio events). */
  text: string;
}

export interface BuildPromptInput {
  /** The event being extracted. */
  current: PromptContextEvent;
  /** Up to N prior events from the same team, newest first. */
  recent: PromptContextEvent[];
}

export const EXTRACTION_SYSTEM_PROMPT = `You are an information extractor for a team memory system.

Your job: read a single raw event from a team's timeline and produce structured facts plus the entities they reference.

Rules:
- Output ONLY facts that are explicitly stated in or directly implied by the current event. Do not invent.
- A "fact" is a single, self-contained statement, e.g. "Tim met John Ternus at Apple to discuss SaaS licensing".
- Each fact has a confidence in [0,1]: 1.0 = stated literally, 0.7 = clear implication, <=0.5 = uncertain. Prefer fewer high-confidence facts to many low-confidence ones.
- Entity mentions: extract people, companies, projects, and topics referenced by the fact.
  - "person": individual humans (first name + last name when known, otherwise just the available form).
  - "company": organisations, brands, products acting as orgs.
  - "project": named initiatives, deals, ongoing pieces of work.
  - "topic": subject matter ("SaaS licensing", "Q3 roadmap") that isn't a person/company/project.
  - "other": only when none of the above fits.
- Each mention has a role inside its fact: "subject" (the actor), "object" (acted upon), or "topic" (what it is about).
- Use the recent context only to disambiguate pronouns and short references in the current event. Never emit facts about events that only appear in the context.
- Names: each mention's canonical display name belongs in the exact JSON field "name". Do not use "canonical_name". Include common short forms as "aliases" when relevant (e.g. name "John Ternus", aliases ["John"]).
- Required fact fields are exactly "statement", "confidence", and "mentions". Do not use "text", "entities", or other aliases.`;

const MAX_CONTEXT_CHARS = 4000;
const MAX_PER_EVENT_CHARS = 800;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function buildExtractionPrompt(input: BuildPromptInput): string {
  const lines: string[] = [];
  if (input.recent.length > 0) {
    lines.push('# Recent events (context only — DO NOT extract facts from these)');
    let budget = MAX_CONTEXT_CHARS;
    for (const ev of input.recent) {
      const text = truncate(ev.text, MAX_PER_EVENT_CHARS);
      const entry = `- [${ev.occurredAt}] ${text}`;
      if (entry.length > budget) break;
      lines.push(entry);
      budget -= entry.length;
    }
    lines.push('');
  }
  lines.push('# Current event (extract facts FROM this)');
  lines.push(`[${input.current.occurredAt}] ${input.current.text}`);
  return lines.join('\n');
}
