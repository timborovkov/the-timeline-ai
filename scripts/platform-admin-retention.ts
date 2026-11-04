import { parseArgs } from 'node:util';
import { closeDb, getDb } from '@timeline/db';
import {
  placePlatformRetentionHold,
  releasePlatformRetentionHold,
} from '@timeline/shared/platform-admin/retention';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'actor-user-id': { type: 'string' },
    'actor-email': { type: 'string' },
    team: { type: 'string' },
    user: { type: 'string' },
    hold: { type: 'string' },
    reason: { type: 'string' },
    reference: { type: 'string' },
  },
});
const actor = { userId: values['actor-user-id'] ?? '', email: values['actor-email'] ?? '' };
try {
  if (positionals[0] === 'place' && Boolean(values.team) !== Boolean(values.user)) {
    const hold = await placePlatformRetentionHold(getDb(), actor, {
      kind: values.team ? 'team' : 'user',
      id: values.team ?? values.user ?? '',
      reason: values.reason ?? '',
      reference: values.reference ?? '',
    });
    console.log(`Retention hold created: ${hold.id}`);
  } else if (positionals[0] === 'release' && values.hold) {
    await releasePlatformRetentionHold(getDb(), actor, values.hold, values.reason ?? '');
    console.log(
      'Retention hold released. Eligible records will be removed by scheduled maintenance.',
    );
  } else {
    throw new Error(
      'Usage: place --team UUID|--user UUID --reason TEXT --reference TICKET, or release --hold UUID --reason TEXT; both require --actor-user-id UUID --actor-email EMAIL',
    );
  }
} finally {
  await closeDb();
}
