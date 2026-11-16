import type { ActionState } from '@/lib/action-result';

export interface ObjectActionState extends ActionState {
  undoChangeId?: string;
}
