interface ConnectionAttention {
  id: string;
  category: string;
}

interface ConnectionAttentionRow {
  attention: readonly ConnectionAttention[];
}

function isBlockingConnectionAttention(category: string) {
  return category !== 'webhook_degraded';
}

export function visibleConnectionAttentionStats(connectedRows: readonly ConnectionAttentionRow[]) {
  const visibleAttention = new Map<string, ConnectionAttention>();
  for (const row of connectedRows) {
    for (const item of row.attention) {
      visibleAttention.set(item.id, item);
    }
  }
  const attention = [...visibleAttention.values()];
  const blockingAttentionCount = attention.filter((item) =>
    isBlockingConnectionAttention(item.category),
  ).length;
  return {
    blockingAttentionCount,
    webhookDegradedCount: attention.length - blockingAttentionCount,
  };
}
