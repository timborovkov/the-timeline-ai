import { z } from 'zod';

import { OBJECT_TYPES } from '#src/objects/types.js';

export const boardQualificationPolicySchema = z
  .object({
    qualificationEnabled: z.boolean().default(false),
    qualificationInstructions: z.string().trim().max(2000).default(''),
    strictObjectTypes: z.boolean().default(false),
    recommendedObjectTypes: z
      .array(z.enum([...OBJECT_TYPES, 'link']))
      .max(32)
      .default([]),
  })
  .superRefine((policy, ctx) => {
    if (policy.qualificationEnabled && !policy.qualificationInstructions) {
      ctx.addIssue({
        code: 'custom',
        path: ['qualificationInstructions'],
        message: 'Describe what belongs on this board.',
      });
    }
    if (policy.strictObjectTypes && policy.recommendedObjectTypes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['recommendedObjectTypes'],
        message: 'Choose at least one allowed object type.',
      });
    }
  });

export function assertBoardObjectType(
  board: { strictObjectTypes: boolean; recommendedObjectTypes: unknown },
  type: string,
) {
  if (
    board.strictObjectTypes &&
    (!Array.isArray(board.recommendedObjectTypes) || !board.recommendedObjectTypes.includes(type))
  ) {
    throw new Error('This object type is not allowed on this board.');
  }
}
