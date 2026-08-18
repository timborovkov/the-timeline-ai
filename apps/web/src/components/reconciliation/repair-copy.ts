export function repairFailureCopy(failure: {
  code: string;
  message: string;
  rawEventCount: number;
}): {
  detail: string;
  hint: string;
  status: string;
} {
  const count = failure.rawEventCount.toLocaleString();
  const singular = failure.rawEventCount === 1;
  const hint = `${failure.code}: ${failure.message}`;
  if (failure.code.toLowerCase() === 'degraded_replay') {
    return {
      status: 'Needs replay',
      detail: singular
        ? '1 capture needs a full evidence rebuild'
        : `${count} captures need a full evidence rebuild`,
      hint,
    };
  }
  return {
    status: 'Needs evidence',
    detail: singular ? '1 capture has no evidence yet' : `${count} captures have no evidence yet`,
    hint,
  };
}
