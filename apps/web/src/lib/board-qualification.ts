import type { ObjectType } from '@timeline/shared/objects/types';

export interface BoardQualificationDraft {
  qualificationEnabled: boolean;
  qualificationInstructions: string;
  strictObjectTypes: boolean;
  recommendedObjectTypes: ObjectType[];
}
export const EMPTY_BOARD_QUALIFICATION: BoardQualificationDraft = {
  qualificationEnabled: false,
  qualificationInstructions: '',
  strictObjectTypes: false,
  recommendedObjectTypes: [],
};
