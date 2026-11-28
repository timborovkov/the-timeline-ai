export const BOARD_TEMPLATE_KINDS = ['pipeline', 'task_board', 'catalog', 'custom'] as const;
export type BoardTemplateKind = (typeof BOARD_TEMPLATE_KINDS)[number];

export const BOARD_LANE_KINDS = ['active', 'done', 'terminal', 'lost', 'blocked'] as const;
export type BoardLaneKind = (typeof BOARD_LANE_KINDS)[number];
