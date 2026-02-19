import { describe, expect, it } from 'vitest';

import { formatDigest } from './formatDigest';

describe('formatDigest', () => {
  it('bounds output by maxItems and includes required fields', () => {
    const { slackText, webhookPayload } = formatDigest({
      digest: {
        subject: 'Week in Review — 2026-01-01 to 2026-01-08 — p1',
        stats: { risks: 2, openLoops: 3, decisions: 1, actions: 0 },
        top: {
          risks: [{ text: 'r1' }, { text: 'r2' }, { text: 'r3' }],
          openLoops: [{ text: 'o1' }, { text: 'o2' }],
          decisions: [{ text: 'd1' }, { text: 'd2' }],
        },
        links: { drilldownUrl: '/timeline?entity=acme', reportUrl: 'https://drive.google.com/file/d/1/view' },
      },
      job: { id: 'week', type: 'week_in_review', runKey: 'rk' },
      recipient: { key: 'p1', profileName: 'P1' },
      maxItems: 2,
    });

    expect(slackText).toContain('Risks: 2 | Open loops: 3 | Decisions: 1');
    expect(webhookPayload.version).toBe(1);
    expect(webhookPayload.top.risks).toHaveLength(2);
    expect(webhookPayload.top.decisions).toHaveLength(2);
  });
});
