const SCHEDULABLE_OBJECT_TYPES = ['task', 'follow_up', 'project', 'deal'] as const;

export function isSchedulableObjectType(type: string): boolean {
  return SCHEDULABLE_OBJECT_TYPES.some((candidate) => candidate === type);
}
