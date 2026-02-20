import { describe, expect, it } from 'vitest';

import { NotificationCircuitBreakerSchema, ScheduleConfigSchema } from './timeline.js';

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


describe('NotificationCircuitBreakerSchema', () => {
  it('accepts valid entries', () => {
    const result = NotificationCircuitBreakerSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      targets: [
        { channel: 'email', recipientKey: 'broadcast', state: 'muted', failureCount: 3, mutedUntilISO: '2026-01-01T00:30:00Z', lastError: { message: 'x' } },
        { channel: 'slack', targetKey: 'TEAM_A', state: 'open', failureCount: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing key fields', () => {
    const result = NotificationCircuitBreakerSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      targets: [{ channel: 'slack', state: 'open', failureCount: 1 }],
    });
    expect(result.success).toBe(false);
  });
});


describe('SummaryArtifactSchema userAnnotations', () => {
  const baseArtifact = {
    artifactId: 'a1',
    source: 'drive',
    sourceId: 'src-1',
    title: 'Artifact',
    createdAtISO: '2026-01-01T00:00:00.000Z',
    summary: 'Summary',
    highlights: ['h'],
    driveFolderId: 'folder-1',
    driveFileId: 'file-1',
    model: 'stub',
    version: 1,
  };

  it('accepts valid userAnnotations shape', async () => {
    const { SummaryArtifactSchema } = await import('./timeline.js');
    const result = SummaryArtifactSchema.safeParse({
      ...baseArtifact,
      userAnnotations: {
        entities: ['Alice', 'Bob'],
        location: 'London',
        amount: '£1200',
        note: 'Provided manually',
        updatedAtISO: '2026-01-02T00:00:00.000Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid userAnnotations values', async () => {
    const { SummaryArtifactSchema } = await import('./timeline.js');
    const result = SummaryArtifactSchema.safeParse({
      ...baseArtifact,
      userAnnotations: {
        entities: Array.from({ length: 26 }, (_, i) => `e${i}`),
      },
    });
    expect(result.success).toBe(false);
  });
});
