export const TRUST_FLOW_STEPS = [
  {
    index: '01',
    title: 'Evidence arrives',
    detail: 'Telegram / linked launch group',
  },
  {
    index: '02',
    title: 'Original stays intact',
    detail: 'Captured source / immutable',
  },
  {
    index: '03',
    title: 'Access is checked',
    detail: 'Team + event visibility',
  },
  {
    index: '04',
    title: 'Suggested changes wait',
    detail: 'Human approval required',
  },
] as const;

export const TRUST_FLOW_CHIPS = [
  'Immutable raw evidence',
  'Team isolation',
  'Per-event privacy',
  'Inspectable citations',
  'Approval-backed suggestions',
] as const;
