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
    title: 'Changes stay traceable',
    detail: 'Applied history and review queue',
  },
] as const;

export const TRUST_FLOW_CHIPS = [
  'Immutable raw evidence',
  'Team isolation',
  'Per-event privacy',
  'Inspectable citations',
  'Evidence-linked changes',
] as const;
