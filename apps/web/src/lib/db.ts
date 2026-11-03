import { getDb } from '@timeline/db';
import { operatorDatabase } from '@timeline/shared/platform-admin/runtime';

export const db = operatorDatabase(getDb());
