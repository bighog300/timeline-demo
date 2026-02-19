import { describe, expect, it } from 'vitest';

import { ScheduleConfigSchema } from './timeline.js';

describe('ScheduleConfigSchema channel notifications', () => {
  const base = {
    version: 1,
    updatedAtISO: '2026-01-01T00:00:00Z',
    recipientProfiles: [{ id: 'p1', to: ['p1@example.com'], filters: {} }],
    jobs: [{
      id: 'week',
      type: 'week_in_review',
      enabled: true,
      schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
      notify: {
        enabled: true,
        mode: 'routes',
        routes: [{ profileId: 'p1' }],
      },
    }],
  } as const;

  it('parses valid slack/webhook channel config', () => {
    const parsed = ScheduleConfigSchema.parse({
      ...base,
      jobs: [{
        ...base.jobs[0],
        notify: {
          ...base.jobs[0].notify,
          channels: {
            slack: { enabled: true, targets: ['TEAM_A'], maxItems: 8 },
            webhook: { enabled: true, targets: ['OPS'], payloadVersion: 1 },
          },
        },
      }],
    });

    expect(parsed.jobs[0]?.notify?.channels?.slack?.targets).toEqual(['TEAM_A']);
  });

  it('rejects invalid webhook target keys', () => {
    const result = ScheduleConfigSchema.safeParse({
      ...base,
      jobs: [{
        ...base.jobs[0],
        notify: {
          ...base.jobs[0].notify,
          channels: {
            slack: { enabled: true, targets: ['https://hooks.slack.com/services/a/b/c'] },
          },
        },
      }],
    });

    expect(result.success).toBe(false);
  });

  it('keeps backward compatibility without channels', () => {
    const result = ScheduleConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
  });
});
