export function normalizeExtractionModelOutput(value: unknown): unknown {
  const candidate = Array.isArray(value) ? { facts: value } : value;
  if (!candidate || typeof candidate !== 'object') return value;
  const row = candidate as Record<string, unknown>;
  const facts = Array.isArray(row.facts) ? (row.facts as unknown[]) : null;
  return {
    ...row,
    ...(facts
      ? {
          facts: facts.map((fact) => {
            if (!fact || typeof fact !== 'object') return fact;
            const factRow = fact as Record<string, unknown>;
            return {
              ...factRow,
              statement: factRow.statement ?? factRow.text,
              mentions: factRow.mentions ?? factRow.entities,
            };
          }),
        }
      : {}),
    choice: row.choice ?? row.candidate_index ?? row.candidateIndex ?? row.index,
  };
}
