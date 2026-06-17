const checks = [
  {
    name: '@timeline/shared calendar recurrence',
    run: async () => {
      const recurrence = await import('../packages/shared/dist/calendar/recurrence.js');
      const normalized = recurrence.validateRRule({
        rrule: 'FREQ=DAILY;COUNT=1',
        startAt: new Date('2026-07-01T09:00:00.000Z'),
        timezone: 'UTC',
      });

      if (normalized !== 'RRULE:FREQ=DAILY;COUNT=1') {
        throw new Error(`Unexpected RRULE normalization result: ${normalized}`);
      }
    },
  },
  {
    name: '@timeline/shared object client types',
    run: async () => {
      const { entityType } = await import('@timeline/db');
      const objectTypes = await import('@timeline/shared/objects/types');

      const dbTypes = [...entityType.enumValues];
      const clientTypes = [...objectTypes.OBJECT_TYPES];

      if (JSON.stringify(clientTypes) !== JSON.stringify(dbTypes)) {
        throw new Error(
          `Object type export drifted from DB enum: ${JSON.stringify({
            clientTypes,
            dbTypes,
          })}`,
        );
      }

      const title = objectTypes.displayObjectTitle({
        canonicalName: 'github/repo#1: Raw title',
        metadata: {
          display_title: 'repo: Raw title',
          display_title_canonical_name: 'github/repo#1: Raw title',
        },
      });

      if (title !== 'repo: Raw title') {
        throw new Error(`Unexpected display title: ${title}`);
      }
    },
  },
];

for (const check of checks) {
  try {
    await check.run();
    console.log(`[dist-imports] ${check.name}: ok`);
  } catch (error) {
    console.error(`[dist-imports] ${check.name}: failed`);
    throw error;
  }
}
