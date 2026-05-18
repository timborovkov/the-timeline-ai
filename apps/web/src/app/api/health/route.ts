import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = { ok: dbOk, db: dbOk ? 'up' : 'down' };
  return Response.json(body, { status: dbOk ? 200 : 503 });
}
