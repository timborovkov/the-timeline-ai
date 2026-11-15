import { createHash } from 'node:crypto';

import type { SuggestionCase } from '#src/evals/suggestion-cases.js';
import type { SuggestionObservation } from '#src/evals/suggestion-report.js';

export const COMM_TEAM = '11111111-1111-4111-8111-111111111111';
export const COMM_FOREIGN = '22222222-2222-4222-8222-222222222222';
export const COMM_ACTORS = {
  alice: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
export type Actor = keyof typeof COMM_ACTORS;
export interface CommunicationNode {
  key: string;
  type: 'company' | 'project' | 'task';
  name: string;
  terms?: string[][];
  aliases?: string[];
  /** Explicit equivalent renderings reviewed with the label rationale. */
  acceptedNames?: string[];
  status?: string;
  assignee?: Actor | null;
  dueAt?: string | null;
}
/** Expectations are complete; omission must never silently disable field scoring. */
export interface CommunicationExpectedNode extends CommunicationNode {
  status: string;
  assignee: Actor | null;
  dueAt: string | null;
}
export interface CommunicationEdge {
  from: string;
  to: string;
  kind: 'child' | 'related';
}
export interface CommunicationMessage {
  text: string;
  actor?: Actor;
  /** Run the review before delivering the next message, preserving real pending state. */
  flush?: boolean;
  private?: boolean;
  replay?: boolean;
  offsetMinutes?: number;
  mustReachModel?: string[];
}
export type EmailPackaging = 'plain' | 'gmail' | 'outlook' | 'apple' | 'html' | 'nested';
export interface CommunicationCase extends SuggestionCase {
  source: 'email' | 'slack' | 'telegram';
  category: string;
  messages: CommunicationMessage[];
  seed: CommunicationNode[];
  pending?: { node: CommunicationNode; edited?: boolean }[];
  outcome: { nodes: CommunicationExpectedNode[]; edges: CommunicationEdge[] };
  packaging?: EmailPackaging;
  prohibitedText?: string[];
  uncertain?: boolean;
}
export interface ObservedNode {
  id: string;
  type: string;
  name: string;
  status: string;
  assigneeUserId: string | null;
  dueAt: string | null;
}
export interface ObservedEdge {
  from: string;
  to: string;
  kind: string;
}
export interface CommunicationObservation extends SuggestionObservation {
  nodes: ObservedNode[];
  edges: ObservedEdge[];
  acceptanceErrors: number;
  acceptanceFailureReasons: string[];
  approvalOutcomes?: {
    title: string;
    status: string;
    resultId: string | null;
    reason: string | null;
  }[];
  duplicateProposals: number;
  packetLoss: string[];
  protectedPendingChanged: boolean;
  uncertaintyMissing: boolean;
  capturedEvents: number;
  queuedJobs: number;
  source: string;
  familyId: string;
}
export function communicationId(family: string, key: string) {
  const hex = createHash('sha256').update(`communications:${family}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
