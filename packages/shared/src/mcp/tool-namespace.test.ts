import { describe, expect, it } from 'vitest';

import { compactToServerId, namespaceToolName, parseNamespacedToolName } from './tool-namespace.js';

describe('mcp/tool-namespace', () => {
  const serverId = '6f1f1c5e-9d3d-4b7e-9c1a-7e1d3c1d7b9f';
  const compact = '6f1f1c5e9d3d4b7e9c1a7e1d3c1d7b9f';

  it('namespaces with the dashless serverId', () => {
    expect(namespaceToolName(serverId, 'search')).toBe(`mcp__${compact}__search`);
  });

  it('roundtrips', () => {
    const ns = namespaceToolName(serverId, 'list_repos');
    const parsed = parseNamespacedToolName(ns);
    expect(parsed).toEqual({ serverIdCompact: compact, toolName: 'list_repos' });
    if (parsed) expect(compactToServerId(parsed.serverIdCompact)).toBe(serverId);
  });

  it('rejects malformed names', () => {
    expect(parseNamespacedToolName('not-an-mcp-tool')).toBeNull();
    expect(parseNamespacedToolName('mcp__short__name')).toBeNull();
  });

  it('handles tool names with double underscores', () => {
    const ns = namespaceToolName(serverId, 'tool__inner');
    const parsed = parseNamespacedToolName(ns);
    expect(parsed?.toolName).toBe('tool__inner');
  });
});
