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
