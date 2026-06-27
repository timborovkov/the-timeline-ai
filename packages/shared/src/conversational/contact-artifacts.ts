import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js/min';

import { sourceMetadataWithLinks } from '#src/conversational/link-artifacts.js';

const EMAIL_RE =
  /(?<![A-Z0-9._%+-])([A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+)(?![A-Z0-9_%+-])/gi;
const SLACK_MAILTO_RE = /<mailto:([^>|]+)(?:\|([^>]+))?>/gi;
const SLACK_TEL_RE = /<tel:([^>|]+)(?:\|([^>]+))?>/gi;
const URL_RE = /https?:\/\/[^\s<>"'|]+/gi;
const CONTACT_SCHEME_RE = /\b(?:mailto|tel):[^\s<>"']+/gi;
const ADDRESS_CUE_RE =
  /\b(address|office address|billing address|shipping address|hq|headquarters|venue|location)\s*:\s*([^\n;]{6,180})/gi;
const TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/;
const TIMELINE_OWNED_EMAIL_DOMAINS = new Set(['inbound.invalid']);
const MAX_EMAIL_CONTACTS = 50;
const MAX_PHONE_CONTACTS = 50;
const MAX_ADDRESS_CONTACTS = 25;

export type ContactConfidence = 'structured' | 'explicit' | 'inferred';
export type CapturedContactKind = 'email' | 'phone' | 'address';
export type CapturedAddressKind = 'postal_address' | 'venue' | 'meeting_location' | 'unknown';

export interface CapturedEmail {
  kind: 'email';
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  label: string | null;
  context: string | null;
  confidence: ContactConfidence;
}

export interface CapturedPhone {
  kind: 'phone';
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  label: string | null;
  context: string | null;
  confidence: ContactConfidence;
  country: string | null;
}

export interface CapturedAddress {
  kind: 'address';
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  label: string | null;
  context: string | null;
  confidence: ContactConfidence;
  addressKind: CapturedAddressKind;
}

export type CapturedContact = CapturedEmail | CapturedPhone | CapturedAddress;

export interface ContactEmailMetadata {
  raw_value: string;
  normalized_value: string;
  display_value: string;
  label: string | null;
  context: string | null;
  confidence: ContactConfidence;
}

export interface ContactPhoneMetadata extends ContactEmailMetadata {
  country: string | null;
}

export interface ContactAddressMetadata extends ContactEmailMetadata {
  address_kind: CapturedAddressKind;
}

export interface ContactMetadata {
  emails: ContactEmailMetadata[];
  phones: ContactPhoneMetadata[];
  addresses: ContactAddressMetadata[];
}

export interface ExtractContactsOptions {
  defaultPhoneCountry?: CountryCode;
}

interface Range {
  start: number;
  end: number;
}

function stripTrailingPunctuation(value: string): string {
  let out = value.trim();
  while (TRAILING_PUNCTUATION_RE.test(out)) out = out.replace(TRAILING_PUNCTUATION_RE, '');
  return out;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function optionalTrimmedLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  return trimmed;
}

function normalizedEmail(value: string): string | null {
  const trimmed = stripTrailingPunctuation(value).toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = trimmed.slice(at + 1);
  if (TIMELINE_OWNED_EMAIL_DOMAINS.has(domain)) return null;
  return trimmed;
}

function normalizedAddress(value: string): string {
  return compactWhitespace(stripTrailingPunctuation(value)).toLowerCase();
}

function addressKindForCue(cue: string): CapturedAddressKind {
  const normalized = cue.toLowerCase();
  if (normalized === 'venue' || normalized === 'location') return 'meeting_location';
  if (normalized.includes('address') || normalized === 'hq' || normalized === 'headquarters') {
    return 'postal_address';
  }
  return 'unknown';
}

function rangesFor(text: string, regex: RegExp): Range[] {
  return [...text.matchAll(regex)]
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function overlapsAny(range: Range, ranges: Range[]): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = ranges[mid];
    if (candidate && candidate.start < range.end) low = mid + 1;
    else high = mid;
  }
  const candidate = ranges[low - 1];
  return Boolean(candidate && range.start < candidate.end && range.end > candidate.start);
}

function contactContext(text: string, range: Range): string | null {
  const before = text.slice(Math.max(0, range.start - 48), range.start);
  const after = text.slice(range.end, Math.min(text.length, range.end + 48));
  const context = compactWhitespace(`${before}${text.slice(range.start, range.end)}${after}`);
  return context.length > 0 ? context : null;
}

function regexMatches(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  const matches = regex.test(value);
  regex.lastIndex = 0;
  return matches;
}

function addEmail(
  emails: Map<string, CapturedEmail>,
  input: {
    rawValue: string;
    label?: string | null;
    context?: string | null;
    confidence: ContactConfidence;
  },
): void {
  if (emails.size >= MAX_EMAIL_CONTACTS) return;
  const normalized = normalizedEmail(input.rawValue);
  if (!normalized) return;
  if (emails.has(normalized)) return;
  emails.set(normalized, {
    kind: 'email',
    rawValue: stripTrailingPunctuation(input.rawValue),
    normalizedValue: normalized,
    displayValue: normalized,
    label: optionalTrimmedLabel(input.label),
    context: input.context ?? null,
    confidence: input.confidence,
  });
}

function addPhone(
  phones: Map<string, CapturedPhone>,
  input: {
    rawValue: string;
    normalizedValue: string;
    displayValue: string;
    label?: string | null;
    context?: string | null;
    confidence: ContactConfidence;
    country?: string | null;
  },
): void {
  if (phones.size >= MAX_PHONE_CONTACTS) return;
  const normalized = input.normalizedValue.trim();
  if (!normalized || phones.has(normalized)) return;
  phones.set(normalized, {
    kind: 'phone',
    rawValue: stripTrailingPunctuation(input.rawValue),
    normalizedValue: normalized,
    displayValue: input.displayValue,
    label: optionalTrimmedLabel(input.label),
    context: input.context ?? null,
    confidence: input.confidence,
    country: input.country ?? null,
  });
}

function addAddress(
  addresses: Map<string, CapturedAddress>,
  input: {
    rawValue: string;
    label?: string | null;
    context?: string | null;
    confidence: ContactConfidence;
    addressKind: CapturedAddressKind;
  },
): void {
  const displayValue = compactWhitespace(stripTrailingPunctuation(input.rawValue));
  const normalized = normalizedAddress(displayValue);
  if (addresses.size >= MAX_ADDRESS_CONTACTS) return;
  if (normalized.length < 6 || addresses.has(normalized)) return;
  if (regexMatches(EMAIL_RE, displayValue) || regexMatches(URL_RE, displayValue)) return;
  addresses.set(normalized, {
    kind: 'address',
    rawValue: displayValue,
    normalizedValue: normalized,
    displayValue,
    label: optionalTrimmedLabel(input.label),
    context: input.context ?? null,
    confidence: input.confidence,
    addressKind: input.addressKind,
  });
}

export function extractContactsFromText(
  text: string | null | undefined,
  opts: ExtractContactsOptions = {},
): CapturedContact[] {
  if (!text) return [];
  EMAIL_RE.lastIndex = 0;
  SLACK_MAILTO_RE.lastIndex = 0;
  SLACK_TEL_RE.lastIndex = 0;
  URL_RE.lastIndex = 0;
  CONTACT_SCHEME_RE.lastIndex = 0;
  ADDRESS_CUE_RE.lastIndex = 0;
  const emails = new Map<string, CapturedEmail>();
  const phones = new Map<string, CapturedPhone>();
  const addresses = new Map<string, CapturedAddress>();
  const urlRanges = rangesFor(text, URL_RE);
  const contactSchemeRanges = rangesFor(text, CONTACT_SCHEME_RE);

  for (const match of text.matchAll(SLACK_MAILTO_RE)) {
    addEmail(emails, {
      rawValue: match[1] ?? '',
      label: match[2] ?? null,
      confidence: 'structured',
      context: contactContext(text, {
        start: match.index,
        end: match.index + match[0].length,
      }),
    });
  }

  for (const match of text.matchAll(EMAIL_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsAny({ start, end }, urlRanges)) continue;
    addEmail(emails, {
      rawValue: match[1] ?? match[0],
      confidence: 'explicit',
      context: contactContext(text, { start, end }),
    });
  }

  for (const match of text.matchAll(SLACK_TEL_RE)) {
    const rawValue = match[1] ?? '';
    const phone = findPhoneNumbersInText(rawValue, opts.defaultPhoneCountry ?? 'US')[0]?.number;
    if (!phone?.isValid()) continue;
    addPhone(phones, {
      rawValue,
      normalizedValue: phone.number,
      displayValue: phone.formatInternational(),
      label: match[2] ?? null,
      confidence: 'structured',
      country: phone.country ?? null,
      context: contactContext(text, {
        start: match.index,
        end: match.index + match[0].length,
      }),
    });
  }

  for (const found of findPhoneNumbersInText(text, opts.defaultPhoneCountry ?? 'US')) {
    const range = { start: found.startsAt, end: found.endsAt };
    if (overlapsAny(range, urlRanges) || overlapsAny(range, contactSchemeRanges)) continue;
    if (!found.number.isValid()) continue;
    addPhone(phones, {
      rawValue: text.slice(found.startsAt, found.endsAt),
      normalizedValue: found.number.number,
      displayValue: found.number.formatInternational(),
      confidence: 'explicit',
      country: found.number.country ?? null,
      context: contactContext(text, range),
    });
  }

  for (const match of text.matchAll(ADDRESS_CUE_RE)) {
    const cue = match[1] ?? 'address';
    const rawValue = match[2] ?? '';
    const start = match.index + match[0].indexOf(rawValue);
    const end = start + rawValue.length;
    addAddress(addresses, {
      rawValue,
      label: cue,
      confidence: 'explicit',
      addressKind: addressKindForCue(cue),
      context: contactContext(text, { start, end }),
    });
  }

  return [...emails.values(), ...phones.values(), ...addresses.values()];
}

export function contactMetadata(contacts: CapturedContact[]): ContactMetadata {
  const metadata: ContactMetadata = { emails: [], phones: [], addresses: [] };
  for (const contact of contacts) {
    const base = {
      raw_value: contact.rawValue,
      normalized_value: contact.normalizedValue,
      display_value: contact.displayValue,
      label: contact.label,
      context: contact.context,
      confidence: contact.confidence,
    };
    if (contact.kind === 'email') {
      metadata.emails.push(base);
    } else if (contact.kind === 'phone') {
      metadata.phones.push({ ...base, country: contact.country });
    } else {
      metadata.addresses.push({ ...base, address_kind: contact.addressKind });
    }
  }
  return metadata;
}

export function sourceMetadataWithContacts(
  metadata: Record<string, unknown>,
  text: string | null | undefined,
  opts: ExtractContactsOptions = {},
): Record<string, unknown> {
  const contacts = extractContactsFromText(text, opts);
  if (contacts.length === 0) return metadata;
  return { ...metadata, contacts: contactMetadata(contacts) };
}

export function sourceMetadataWithConversationArtifacts(
  metadata: Record<string, unknown>,
  text: string | null | undefined,
  opts: ExtractContactsOptions = {},
): Record<string, unknown> {
  return sourceMetadataWithContacts(sourceMetadataWithLinks(metadata, text), text, opts);
}

export function textHasContacts(text: string | null | undefined): boolean {
  return extractContactsFromText(text).length > 0;
}
