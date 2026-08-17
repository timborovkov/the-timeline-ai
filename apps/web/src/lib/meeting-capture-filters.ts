export const CAPTURE_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'ended', label: 'Not captured' },
] as const;

export type CaptureFilter = (typeof CAPTURE_FILTERS)[number]['value'];
