import type { PostmarkAddress, PostmarkInbound } from '#src/email/postmark-schema.js';

export const MAX_EMAIL_REFERENCES = 50;
const MAX_REFERENCE_ID_LENGTH = 998;

/**
 * Parsed address pair shaped for storage in `source_metadata`. Stable JSON
 * keys (snake-friendly) so downstream consumers (UI, agent) don't need a
 * Postmark-specific mapping.
 */
export interface ParsedAddress {
  email: string;
  name?: string;
}

export interface ForwardedMessage {
  from: ParsedAddress;
  to?: ParsedAddress[];
  cc?: ParsedAddress[];
  subject?: string;
  date?: string;
  body?: string;
}

/**
 * Header lookup is case-insensitive — the wire format is mixed-case in
 * practice (Mail clients shotgun "Message-ID", "Message-Id", "MESSAGE-ID").
 * Returns the first match.
 */
export function getHeader(headers: PostmarkInbound['Headers'], name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.Name.toLowerCase() === lower) return h.Value;
  }
  return undefined;
}

/**
 * Strip RFC 5322 angle brackets from an identifier (Message-ID,
 * In-Reply-To, References-list entry). A bare `<abc@host>` becomes `abc@host`.
 * Whitespace is also stripped. Returns null for unparseable inputs so the
 * caller can decide between "no thread context" and "couldn't normalize".
 */
export function normalizeMessageId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // The header may contain comments / multiple ids; take the first <...> form
  // and fall back to the whole token if no brackets are present.
  const match = /<([^>]+)>/.exec(trimmed);
  if (match?.[1]) return match[1].trim();
  return trimmed;
}

/**
 * Parse a References header (or any space-separated list of <message-id>s)
 * into an array of normalized ids. Empty input → empty array. The header is
 * sender-controlled, so keep only a bounded, deduped tail of the chain; email
 * threading prefers the newest ancestors anyway.
 */
export function parseReferences(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const id = m[1]?.trim();
    if (id) out.push(id);
  }
  if (out.length > 0) return boundReferences(out);
  // Fallback: whitespace-separated bare tokens.
  return boundReferences(raw.split(/\s+/));
}

function boundReferences(ids: string[]): string[] {
  const seen = new Set<string>();
  const newestUnique: string[] = [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]?.trim();
    if (!id || id.length > MAX_REFERENCE_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    newestUnique.push(id);
    if (newestUnique.length >= MAX_EMAIL_REFERENCES) break;
  }
  return newestUnique.reverse();
}

/**
 * Lower-case + trim an email for equality comparisons. Email local-parts are
 * technically case-sensitive by RFC, but no mainstream provider treats them
 * that way; folding to lower preserves the matching we want for sender
 * verification against `users.email` (also stored lower-cased).
 */
export function normalizeEmail(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export function toParsed(addr: PostmarkAddress | undefined): ParsedAddress | null {
  if (!addr) return null;
  const email = normalizeEmail(addr.Email);
  if (!email) return null;
  const name = addr.Name.trim();
  return name ? { email, name } : { email };
}

export function toParsedList(addrs: PostmarkAddress[] | undefined): ParsedAddress[] {
  if (!addrs) return [];
  const out: ParsedAddress[] = [];
  for (const a of addrs) {
    const p = toParsed(a);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Best-effort detection of audio attachments. We trust Postmark's
 * `ContentType` first (sender-controlled but at least parsed from MIME
 * headers, not the filename); the filename extension is only consulted when
 * the content-type is the generic `application/octet-stream` Postmark falls
 * back to for unknown parts. A file literally named `evil.mp3` carrying
 * `ContentType: application/zip` is NOT treated as audio.
 *
 * The audio-MIME check is a single `startsWith('audio/')` because every
 * IANA-registered audio type (and every vendor prefix we care about —
 * `audio/x-m4a`, `audio/x-wav`, etc.) shares the `audio/` prefix. Don't add
 * a separate "known audio types" set here; it would be redundant and
 * silently dead.
 */
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'webm', 'aac', 'flac']);

export function isAudioAttachment(filename: string, contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ct.startsWith('audio/')) return true;
  if (ct === 'application/octet-stream') {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    return AUDIO_EXTENSIONS.has(ext);
  }
  return false;
}

/**
 * Strip quoted-reply chains from a plain-text email body. Postmark already
 * does most of this via `StrippedTextReply`; this is the fallback for cases
 * where the field is absent or empty (Postmark doesn't ship it for every
 * sender's quoting style). The implementation is intentionally conservative:
 * cut at the first reliably-recognized "On <date>, <sender> wrote:" line or
 * a long run of leading-`>` quoted lines.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  // Cut at "On <date>, <addr> wrote:" — both Gmail and Apple Mail emit this
  // shape in the user's locale; we match in English only (best-effort).
  const onWroteRe = /^On .{1,120} wrote:\s*$/i;
  // Also cut at the bare separator that Outlook uses.
  const outlookSepRe = /^-{3,}\s*Original Message\s*-{3,}\s*$/i;
  // Or a long block of `> ` quoted lines starting after a blank line.
  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (onWroteRe.test(line) || outlookSepRe.test(line)) {
      cutAt = i;
      break;
    }
  }
  const head = cutAt >= 0 ? lines.slice(0, cutAt) : lines;
  // Drop any trailing all-quoted block (leading-`>`).
  while (head.length > 0) {
    const last = head[head.length - 1] ?? '';
    if (last.trim().startsWith('>') || last.trim() === '') {
      head.pop();
    } else {
      break;
    }
  }
  return head.join('\n').trim();
}

/**
 * Parse the forwarded-header block emitted by major mail clients into a
 * { email, name? } pair describing the *original* sender. The team member
 * who pressed "Forward" remains the event's authorUserId; this captures the
 * party whose words the team actually cares about.
 *
 * Returns null when the body doesn't contain a recognizable forwarded
 * header. Robust to the three common variants:
 *   - Gmail/Apple Mail: `---------- Forwarded message ---------\nFrom: ...`
 *   - Apple Mail (alt): `Begin forwarded message:\nFrom: ...`
 *   - Outlook: `From: <sender>\nSent: <date>\nTo: <recipient>\nSubject:`
 *     (no separator line; only triggered when subject starts with Fwd/Fw)
 */
const ADDR_RE = /([^<\s]+@[^>\s]+)/;
const NAME_AND_ADDR_RE = /^\s*"?([^"<]+?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>/;

export function parseForwardedFrom(opts: {
  subject: string;
  textBody: string;
}): ParsedAddress | null {
  const first = parseForwardedChain(opts)[0];
  if (first) return first.from;
  const { subject, textBody } = opts;
  if (!textBody) return null;

  // Find a candidate "forwarded block" start. Be tolerant about whitespace
  // and the number of dashes (Gmail uses 10, Apple Mail uses 8, some clients
  // use just "Forwarded message" without dashes).
  const candidates: { start: number }[] = [];
  const blockRe = /[-_=]{2,}\s*forwarded message\s*[-_=]{0,}/i;
  const beginRe = /begin forwarded message:/i;
  let m = blockRe.exec(textBody);
  if (m) candidates.push({ start: m.index });
  m = beginRe.exec(textBody);
  if (m) candidates.push({ start: m.index });

  // Outlook fallback: only consider it a forward when the subject has the
  // forward prefix. Otherwise a normal reply with the user's signature
  // ("From: …") would false-positive.
  const subjectLooksForwarded = /^(?:fw|fwd):/i.test(subject.trim());
  if (subjectLooksForwarded && candidates.length === 0) {
    const outlookFromRe = /^\s*From:\s*.+$/im;
    const om = outlookFromRe.exec(textBody);
    if (om) candidates.push({ start: om.index });
  }

  if (candidates.length === 0) return null;

  // Pick the earliest candidate and scan forward for the first "From:" line.
  candidates.sort((a, b) => a.start - b.start);
  const start = candidates[0]?.start ?? 0;
  const tail = textBody.slice(start);
  const fromLineRe = /^\s*From:\s*(.+)$/im;
  const fromMatch = fromLineRe.exec(tail);
  if (!fromMatch?.[1]) return null;

  const rawFrom = fromMatch[1].trim();
  // Try "Name <email>" first.
  const named = NAME_AND_ADDR_RE.exec(rawFrom);
  if (named?.[1] && named[2]) {
    return { email: normalizeEmail(named[2]), name: named[1].trim() };
  }
  // Fall back to a bare email address anywhere in the line.
  const addr = ADDR_RE.exec(rawFrom);
  if (addr?.[1]) return { email: normalizeEmail(addr[1]) };
  return null;
}

export function parseForwardedChain(opts: {
  subject: string;
  textBody: string;
}): ForwardedMessage[] {
  const { subject, textBody } = opts;
  if (!textBody) return [];
  const lines = indexedLines(textBody);
  const candidates = forwardedCandidates(lines, /^(?:fw|fwd):/i.test(subject.trim()));
  const parsed: ParsedForwardedCandidate[] = [];
  for (const candidate of candidates) {
    const message = parseForwardedCandidate(lines, candidate);
    if (message) parsed.push(message);
  }
  const out: ForwardedMessage[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item) continue;
    const next = parsed[i + 1];
    const bodyEnd = next ? next.markerStart : textBody.length;
    const body = textBody.slice(item.bodyStart, bodyEnd).trim();
    const msg: ForwardedMessage = { from: item.from };
    if (item.to.length > 0) msg.to = item.to;
    if (item.cc.length > 0) msg.cc = item.cc;
    if (item.subject) msg.subject = item.subject;
    if (item.date) msg.date = item.date;
    if (body) msg.body = body;
    out.push(msg);
  }
  return out;
}

interface IndexedLine {
  text: string;
  start: number;
  end: number;
  nextStart: number;
}

interface ForwardedCandidate {
  markerLine: number;
  headerLine: number;
}

interface ParsedForwardedCandidate extends ForwardedMessage {
  markerStart: number;
  bodyStart: number;
  to: ParsedAddress[];
  cc: ParsedAddress[];
}

function indexedLines(text: string): IndexedLine[] {
  const lines: IndexedLine[] = [];
  const re = /.*(?:\r?\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (!raw && m.index === text.length) break;
    const lineBreak = /\r?\n$/.exec(raw)?.[0] ?? '';
    const end = m.index + raw.length - lineBreak.length;
    lines.push({
      text: raw.slice(0, raw.length - lineBreak.length),
      start: m.index,
      end,
      nextStart: m.index + raw.length,
    });
    if (m.index + raw.length >= text.length) break;
  }
  return lines;
}

function forwardedCandidates(lines: IndexedLine[], includeOutlook: boolean): ForwardedCandidate[] {
  const markedCandidates: ForwardedCandidate[] = [];
  const usedHeaderLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isForwardedMarker(line.text)) {
      const headerLine = findNextHeaderLine(lines, i + 1);
      if (headerLine !== -1 && !usedHeaderLines.has(headerLine)) {
        markedCandidates.push({ markerLine: i, headerLine });
        usedHeaderLines.add(headerLine);
      }
    }
  }
  if (!includeOutlook) return markedCandidates;

  const candidates: ForwardedCandidate[] = [];
  const firstMarkedLine =
    markedCandidates.length > 0
      ? Math.min(...markedCandidates.map((candidate) => candidate.markerLine))
      : Number.POSITIVE_INFINITY;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i >= firstMarkedLine) break;
    if (
      !usedHeaderLines.has(i) &&
      isHeaderLine(line.text, 'from') &&
      looksLikeOutlookForward(lines, i)
    ) {
      candidates.push({ markerLine: i, headerLine: i });
      usedHeaderLines.add(i);
    }
  }
  return [...candidates, ...markedCandidates].sort((a, b) => a.markerLine - b.markerLine);
}

function isForwardedMarker(line: string): boolean {
  return (
    /[-_=]{2,}\s*forwarded message\s*[-_=]{0,}/i.test(line) ||
    /begin forwarded message:/i.test(line)
  );
}

function findNextHeaderLine(lines: IndexedLine[], start: number): number {
  for (let i = start; i < Math.min(lines.length, start + 10); i++) {
    const line = lines[i];
    if (!line) continue;
    if (isHeaderLine(line.text, 'from')) return i;
    if (line.text.trim() && !/^[>\s]*$/.test(line.text)) continue;
  }
  return -1;
}

function looksLikeOutlookForward(lines: IndexedLine[], fromLine: number): boolean {
  let hasDate = false;
  let hasRecipientOrSubject = false;
  for (let i = fromLine + 1; i < Math.min(lines.length, fromLine + 8); i++) {
    const text = lines[i]?.text ?? '';
    if (!text.trim()) break;
    if (isHeaderLine(text, 'sent') || isHeaderLine(text, 'date')) hasDate = true;
    if (isHeaderLine(text, 'to') || isHeaderLine(text, 'subject')) hasRecipientOrSubject = true;
  }
  return hasDate && hasRecipientOrSubject;
}

function isHeaderLine(line: string, name: string): boolean {
  return new RegExp(`^\\s*${name}\\s*:`, 'i').test(line);
}

function parseForwardedCandidate(
  lines: IndexedLine[],
  candidate: ForwardedCandidate,
): ParsedForwardedCandidate | null {
  const headers: Record<string, string> = {};
  let currentKey: string | null = null;
  let bodyLine = candidate.headerLine + 1;
  for (let i = candidate.headerLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line) break;
    const text = line.text;
    if (!text.trim()) {
      bodyLine = i + 1;
      break;
    }
    const match = /^\s*([A-Za-z][A-Za-z-]{0,40})\s*:\s*(.*)$/.exec(text);
    if (match?.[1]) {
      const key = normalizeForwardedHeaderName(match[1]);
      if (!key) {
        bodyLine = i;
        break;
      }
      headers[key] = headers[key]
        ? `${headers[key]} ${match[2]?.trim() ?? ''}`
        : (match[2]?.trim() ?? '');
      currentKey = key;
      bodyLine = i + 1;
      continue;
    }
    if (/^\s+/.test(text) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${text.trim()}`.trim();
      bodyLine = i + 1;
      continue;
    }
    bodyLine = i;
    break;
  }
  const from = parseAddress(headers.from);
  if (!from) return null;
  const parsed: ParsedForwardedCandidate = {
    markerStart: lines[candidate.markerLine]?.start ?? lines[candidate.headerLine]?.start ?? 0,
    bodyStart: lines[bodyLine]?.start ?? lines.at(-1)?.nextStart ?? 0,
    from,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
  };
  const subject = cleanHeaderValue(headers.subject);
  const date = cleanHeaderValue(headers.date ?? headers.sent);
  if (subject) parsed.subject = subject;
  if (date) parsed.date = date;
  return parsed;
}

function normalizeForwardedHeaderName(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key === 'from') return 'from';
  if (key === 'to') return 'to';
  if (key === 'cc') return 'cc';
  if (key === 'subject') return 'subject';
  if (key === 'date') return 'date';
  if (key === 'sent') return 'sent';
  return null;
}

function cleanHeaderValue(raw: string | undefined): string | undefined {
  const value = raw?.replace(/\s+/g, ' ').trim();
  return value && value.length > 0 ? value : undefined;
}

function parseAddress(raw: string | undefined): ParsedAddress | null {
  const value = cleanHeaderValue(raw);
  if (!value) return null;
  const named = NAME_AND_ADDR_RE.exec(value);
  if (named?.[1] && named[2]) {
    return { email: normalizeEmail(named[2]), name: named[1].trim() };
  }
  const addr = ADDR_RE.exec(value);
  if (addr?.[1]) return { email: normalizeEmail(addr[1]) };
  return null;
}

function parseAddressList(raw: string | undefined): ParsedAddress[] {
  const value = cleanHeaderValue(raw);
  if (!value) return [];
  const out: ParsedAddress[] = [];
  const seen = new Set<string>();
  const namedRe = /"?([^"<>]+?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(value)) !== null) {
    const email = normalizeEmail(m[2]);
    if (m[1] && email && !seen.has(email)) {
      seen.add(email);
      out.push({ email, name: m[1].trim() });
    }
  }
  const addrRe = /([^<>,\s]+@[^<>,\s]+)/g;
  while ((m = addrRe.exec(value)) !== null) {
    const email = normalizeEmail(m[1]);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push({ email });
    }
  }
  return out;
}

/**
 * Parse a trusted `Authentication-Results` header into a small struct.
 * RFC 8601 format: `<authserv-id>; spf=pass ...; dkim=pass ...`.
 *
 * SECURITY: every header in `Postmark.Headers[]` is sender-controllable —
 * including ones named `Authentication-Results`. An attacker can inject
 * `Authentication-Results: anything; spf=pass; dkim=pass` into the email
 * body and Postmark passes the raw MIME headers through verbatim. RFC 8601
 * §5 requires the receiver to validate the `authserv-id` (the token before
 * the first `;`) against an allowlist of verifying hosts and ignore headers
 * from anyone else. Without this check the From-spoof defense is a no-op.
 *
 * `allowedAuthservIds` is the trust allowlist. Walk every AR header in the
 * payload (not just the first — first-match would let an attacker shadow
 * Postmark's header by appearing earlier in the array), keep only ones
 * whose authserv-id matches the allowlist case-insensitively. Returns the
 * first match or null. When the allowlist is empty (e.g. dev / staging
 * without `POSTMARK_AUTHSERV_ID` configured), returns null and callers
 * fall back to From-match — preserving the dev workflow without granting
 * trust on every email.
 */
export interface AuthResults {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  authservId: string;
}

export function parseAuthenticationResults(
  headers: { Name: string; Value: string }[],
  allowedAuthservIds: string[],
): AuthResults | null {
  const allowed = new Set(
    allowedAuthservIds.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
  );
  if (allowed.size === 0) return null;
  for (const h of headers) {
    if (h.Name.toLowerCase() !== 'authentication-results') continue;
    const value = h.Value.trim();
    if (!value) continue;
    // authserv-id is the token before the first `;`. Strip RFC-5322
    // `(...)` comments some implementations include, then take the first
    // whitespace-bounded token.
    const idEnd = value.indexOf(';');
    const idPart = (idEnd === -1 ? value : value.slice(0, idEnd))
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)[0];
    if (!idPart) continue;
    if (!allowed.has(idPart.toLowerCase())) continue;
    const rest = (idEnd === -1 ? '' : value.slice(idEnd + 1)).toLowerCase();
    return {
      authservId: idPart.toLowerCase(),
      spf: matchAuthVerb(rest, 'spf'),
      dkim: matchAuthVerb(rest, 'dkim'),
      dmarc: matchAuthVerb(rest, 'dmarc'),
    };
  }
  return null;
}

function matchAuthVerb(header: string, key: string): string | null {
  // Permissive: match `<key>=<verb>` with optional whitespace and stop at
  // the next semicolon, space, or end-of-string. The verb is the first
  // RFC 8601 atom after `=`.
  const re = new RegExp(`(?:^|[;\\s])${key}\\s*=\\s*([a-z]+)`);
  const m = re.exec(header);
  return m?.[1] ?? null;
}

/**
 * Sender-authentication decision: did this email pass enough authentication
 * checks for us to trust the From header? Returns:
 *   - `'absent'`  when no Authentication-Results header is present
 *     (e.g. dev / staging without DKIM signing on the receiving side).
 *     Callers preserve current behavior — From-match still wins.
 *   - `'pass'`    when at least one of SPF or DKIM passes. DMARC is not
 *     required because legitimate forwards from Gmail can fail SPF (the
 *     forwarding MTA is not in the original-domain SPF record) but DKIM
 *     usually survives the forward.
 *   - `'fail'`    when Authentication-Results is present but neither SPF
 *     nor DKIM passed. Caller must treat the sender as unverified
 *     regardless of From-match. This is the From-spoofing defense.
 *
 * Why SPF-or-DKIM (not AND): a forwarded email is the dominant Phase 7
 * use case. SPF breaks on forward, DKIM usually doesn't. Requiring both
 * would reject every forward; requiring either keeps forwards trusted
 * while still catching the case where neither passes (the spoofed
 * cold-send pattern).
 */
export function senderAuthVerdict(results: AuthResults | null): 'absent' | 'pass' | 'fail' {
  if (!results) return 'absent';
  if (results.spf === 'pass' || results.dkim === 'pass') return 'pass';
  return 'fail';
}

/**
 * Decide which content to write to `content_text`. Strategy:
 *   1. Prefer `StrippedTextReply` from Postmark if present and non-empty;
 *      it's their tuned reply-stripper and beats our regex.
 *   2. Otherwise run `stripQuotedReply` on `TextBody`.
 *   3. If both are empty, fall back to a simple HTML-to-text strip on
 *      `HtmlBody` so an HTML-only email isn't reduced to a blank event.
 *
 * The original `TextBody` and `HtmlBody` are preserved in `source_metadata`
 * so re-extraction (Phase 4 pattern) can replay against the unstripped
 * content.
 */
export function chooseContentText(payload: PostmarkInbound): string {
  // Each candidate must produce non-empty content to win. The TextBody case
  // can strip to '' when the entire body is a quoted reply chain (every
  // visible line gets cut by `stripQuotedReply`) — without falling through,
  // such emails land with empty content_text even though the HtmlBody might
  // carry the actual message the sender pasted in. The chain is:
  //   StrippedTextReply (Postmark's tuned stripper) → stripQuotedReply(TextBody)
  //   → htmlToText(HtmlBody) → ''.
  const forwarded = parseForwardedChain({
    subject: payload.Subject,
    textBody: payload.TextBody,
  });
  if (forwarded.length > 0) {
    const intro =
      strippedForwardedIntro({
        subject: payload.Subject,
        textBody: payload.StrippedTextReply,
      }) ||
      forwardedIntro({
        subject: payload.Subject,
        textBody: payload.TextBody,
      });
    return [intro, renderForwardedMessages(forwarded)].filter(Boolean).join('\n\n').trim();
  }
  const stripped = payload.StrippedTextReply.trim();
  if (stripped) return stripped;
  if (payload.TextBody.trim()) {
    const out = stripQuotedReply(payload.TextBody);
    if (out) return out;
  }
  if (payload.HtmlBody.trim()) {
    const out = htmlToText(payload.HtmlBody);
    if (out) return out;
  }
  return '';
}

function strippedForwardedIntro(opts: { subject: string; textBody: string }): string {
  const stripped = opts.textBody.trim();
  if (!stripped) return '';
  const forwarded = parseForwardedChain(opts);
  if (forwarded.length === 0) return stripped;
  return forwardedIntro(opts);
}

function forwardedIntro(opts: { subject: string; textBody: string }): string {
  const { subject, textBody } = opts;
  const lines = indexedLines(textBody);
  const candidates = forwardedCandidates(lines, /^(?:fw|fwd):/i.test(subject.trim()));
  const first = candidates[0];
  if (!first) return '';
  const start = lines[first.markerLine]?.start ?? lines[first.headerLine]?.start ?? 0;
  return textBody.slice(0, start).trim();
}

function renderForwardedMessages(messages: ForwardedMessage[]): string {
  return messages
    .map((message, index) => {
      const lines = [
        `Forwarded message ${index + 1}:`,
        `From: ${formatParsedAddress(message.from)}`,
      ];
      if (message.date) lines.push(`Date: ${message.date}`);
      if (message.subject) lines.push(`Subject: ${message.subject}`);
      if (message.to && message.to.length > 0) {
        lines.push(`To: ${message.to.map(formatParsedAddress).join(', ')}`);
      }
      if (message.cc && message.cc.length > 0) {
        lines.push(`Cc: ${message.cc.map(formatParsedAddress).join(', ')}`);
      }
      if (message.body) lines.push('', message.body);
      return lines.join('\n');
    })
    .join('\n\n');
}

function formatParsedAddress(addr: ParsedAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

/**
 * Minimal HTML-to-text for fallback. Not a sanitizer — the HTML is also
 * preserved verbatim in `source_metadata.html_body`. This exists only so an
 * HTML-only email surfaces *some* text in the timeline and the extraction
 * pipeline has something to work with.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
