import type * as objects from '@timeline/shared/objects/types';

export function relationshipDisplayLabel(input: {
  kind: string;
  sourceType: objects.ObjectType;
  otherType: objects.ObjectType;
  direction: 'in' | 'out';
}): string {
  if (
    input.kind === 'related' &&
    ((input.sourceType === 'person' && input.otherType === 'company') ||
      (input.sourceType === 'company' && input.otherType === 'person'))
  ) {
    return input.sourceType === 'person' ? 'Works at' : 'Contact';
  }
  if (input.kind === 'related') return 'Related';
  if (input.direction === 'out') return input.kind.replace(/_/g, ' ');
  return input.kind.replace(/_/g, ' ');
}
