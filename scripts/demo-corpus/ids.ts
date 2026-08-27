/** Deterministic UUID factory for the expanded demo corpus. Version/variant bits stay RFC 4122. */
export function demoUuid(head: string, n: number): string {
  if (!/^[0-9a-f]{8}$/.test(head)) {
    throw new Error(`demoUuid head must be 8 lowercase hex characters, got ${head}`);
  }
  if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) {
    throw new Error(`demoUuid n must be an integer from 1 to 4294967295, got ${String(n)}`);
  }
  return `${head}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const CORPUS_UUID = {
  user: (n: number) => demoUuid('11000000', n),
  connection: (n: number) => demoUuid('31000000', n),
  integration: (n: number) => demoUuid('41000000', n),
  share: (n: number) => demoUuid('51000000', n),
  selection: (n: number) => demoUuid('61000000', n),
  sync: (n: number) => demoUuid('71000000', n),
  event: (n: number) => demoUuid('92000000', n),
  object: (n: number) => demoUuid('a4000000', n),
  cluster: (n: number) => demoUuid('a5000000', n),
  board: (n: number) => demoUuid('b1000000', n),
  fact: (n: number) => demoUuid('c4000000', n),
  document: (n: number) => demoUuid('45000000', n),
  meeting: (n: number) => demoUuid('56000000', n),
  suggestion: (n: number) => demoUuid('aa000000', n),
  chat: (n: number) => demoUuid('ab000000', n),
  digest: (n: number) => demoUuid('ac000000', n),
  slack: (n: number) => demoUuid('ad000000', n),
  webhook: (n: number) => demoUuid('ae000000', n),
  calendar: (n: number) => demoUuid('af000000', n),
  pin: (n: number) => demoUuid('ba000000', n),
  evidence: (n: number) => demoUuid('bb000000', n),
  note: (n: number) => demoUuid('bc000000', n),
  mention: (n: number) => demoUuid('ca000000', n),
  notification: (n: number) => demoUuid('cb000000', n),
  folder: (n: number) => demoUuid('bd000000', n),
  telegram: (n: number) => demoUuid('be000000', n),
  mcp: (n: number) => demoUuid('bf000000', n),
  relationship: (n: number) => demoUuid('d2000000', n),
  association: (n: number) => demoUuid('f5000000', n),
  facet: (n: number) => demoUuid('a6000000', n),
} as const;
