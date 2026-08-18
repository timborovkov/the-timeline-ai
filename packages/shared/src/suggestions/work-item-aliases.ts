import type { HubAttachableBundle, HubAttachableItem } from '#src/suggestions/hub-context.js';

const GITHUB_REPO_NUMBER = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/giu;
const GITHUB_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull|pulls)\/(\d+)\b/giu;
const GITHUB_PR_ALIAS = /\bPR-([\w.-]+\/[\w.-]+)-(\d+)\b/giu;
const LINEAR_KEY = /\b([A-Z][A-Z0-9]{1,6}-\d+)\b/gu;
const MONDAY_ITEM = /(?:pulses?|items?)\/(\d{6,})\b/giu;
const MONDAY_BARE = /\bmonday(?:\.com)?(?:\s+item)?[:\s#]+(\d{6,})\b/giu;

const LINEAR_KEY_DENYLIST = new Set([
  'ADR',
  'CVE',
  'ISO',
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'RFC',
  'UTF',
]);

export interface UniqueWorkItemAlias {
  alias: string;
  kind: 'github' | 'linear' | 'monday';
}

function collectMatches(
  pattern: RegExp,
  text: string,
  toAlias: (match: RegExpMatchArray) => string | null,
): string[] {
  const aliases: string[] = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const alias = toAlias(match);
    if (alias) aliases.push(alias);
  }
  return aliases;
}

export function uniqueWorkItemAliasesFromText(text: string): UniqueWorkItemAlias[] | null {
  const github = [
    ...collectMatches(GITHUB_REPO_NUMBER, text, (match) => {
      const repo = match[1]?.trim();
      const number = match[2]?.trim();
      return repo && number ? `${repo}#${number}` : null;
    }),
    ...collectMatches(GITHUB_URL, text, (match) => {
      const repo = match[1]?.trim();
      const number = match[2]?.trim();
      return repo && number ? `${repo}#${number}` : null;
    }),
    ...collectMatches(GITHUB_PR_ALIAS, text, (match) => {
      const repo = match[1]?.trim();
      const number = match[2]?.trim();
      return repo && number ? `${repo}#${number}` : null;
    }),
  ];
  const linear = collectMatches(LINEAR_KEY, text, (match) => {
    const key = match[1]?.trim();
    if (!key) return null;
    const prefix = key.split('-')[0] ?? '';
    if (LINEAR_KEY_DENYLIST.has(prefix)) return null;
    return key;
  });
  const monday = [
    ...collectMatches(MONDAY_ITEM, text, (match) => match[1] ?? null),
    ...collectMatches(MONDAY_BARE, text, (match) => match[1] ?? null),
  ];

  const uniqueGithub = [...new Set(github)];
  const uniqueLinear = [...new Set(linear)];
  const uniqueMonday = [...new Set(monday)];
  const found: UniqueWorkItemAlias[] = [
    ...uniqueGithub.map((alias) => ({ alias, kind: 'github' as const })),
    ...uniqueLinear.map((alias) => ({ alias, kind: 'linear' as const })),
    ...uniqueMonday.map((alias) => ({ alias, kind: 'monday' as const })),
  ];
  if (found.length !== 1) return null;
  const only = found[0];
  return only ? [only] : null;
}

function mergeAliases(existing: unknown, extra: readonly string[]): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const current = Array.isArray(existing)
    ? existing.filter((value) => typeof value === 'string')
    : [];
  for (const value of [...current, ...extra]) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
  }
  return aliases;
}

function isCreateTaskItem(item: HubAttachableItem): boolean {
  if (item.operation !== 'create') return false;
  if (item.targetKind === 'task') return true;
  if (item.targetKind !== 'object') return false;
  return item.proposedPayload.type === 'task';
}

export function stampUniqueWorkItemAliasesOntoBundles<T extends HubAttachableItem>(args: {
  bundles: HubAttachableBundle<T>[];
  text: string;
}): HubAttachableBundle<T>[] {
  const unique = uniqueWorkItemAliasesFromText(args.text);
  if (unique?.length !== 1) return args.bundles;
  const extra = unique.flatMap((item) =>
    item.kind === 'github' ? [item.alias, `PR-${item.alias.replace('#', '-')}`] : [item.alias],
  );
  return args.bundles.map((bundle) => ({
    ...bundle,
    items: bundle.items.map((item) => {
      if (!isCreateTaskItem(item)) return item;
      const aliases = mergeAliases(item.proposedPayload.aliases, extra);
      if (
        aliases.length ===
        (Array.isArray(item.proposedPayload.aliases) ? item.proposedPayload.aliases.length : 0)
      ) {
        return item;
      }
      return {
        ...item,
        proposedPayload: {
          ...item.proposedPayload,
          aliases,
        },
      };
    }),
  }));
}
