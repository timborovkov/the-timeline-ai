import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminPage() {
  await requireAdmin();
  redirect('/app/admin/users');
}
