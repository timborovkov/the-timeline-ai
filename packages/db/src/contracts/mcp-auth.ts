export const MCP_AUTH_TYPES = ['none', 'bearer', 'header', 'basic', 'oauth', 'url_key'] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];
