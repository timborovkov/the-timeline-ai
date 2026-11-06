export interface AgentReportingPreference {
  mode: 'on_request' | 'handoffs';
  scope: string;
  revision: string;
}
