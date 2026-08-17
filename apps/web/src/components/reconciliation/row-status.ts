import { statusTone, type StatusTone } from '@/components/collections/collection-status';

export function reconciliationOutputTone(status: string): StatusTone {
  if (status === 'rejected') return 'danger';
  if (status === 'approval_created') return 'review';
  if (status === 'applied') return 'success';
  return statusTone(status);
}
